// test_cobranca_classificar.mjs — classificador dos 3 baldes da cobrança +30d (PRONTO/REVISAR/BLOQUEADO).
// Determinístico, sem API/PII: fixtures no shape NORMALIZADO (o wrapper extrai da resposta real do inadimplencia/index).
// Regras: espinha de segurança da §5-bis do raio-x. Exit 1 em qualquer falha.
import { classificarUnidade, classificarLeva } from '../src/cobranca/inadimplentes.mjs';

let falhas = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK ' : 'FALHA'} ${msg}`); if (!cond) falhas++; };

// fábrica de unidade normalizada com defaults "caso feliz"
function uni(over = {}) {
  return {
    id_unidade: '16346', unidade_label: 'Apto 101', condominio_id: 181,
    email: 'morador@exemplo.com', cpf: '11122233344', nome: 'Fulano',
    boletos: [{ id_recebimento: '1', dias_atraso: 90, valor_total: 500, valor_corrigido: 640, em_processo: false, em_acordo: false }],
    no_juridico: false, garantidora: null, ultimo_contato_dias: null, bounce_anterior: false,
    ...over,
  };
}
const c = (over, opts) => classificarUnidade(uni(over), opts);

// 1) caso feliz → PRONTO
{ const r = c({}); ok(r.balde === 'pronto' && r.elegivel, `caso feliz -> pronto (${r.balde})`); }

// 2) < 30 dias apenas → não elegível (fica fora da leva), não é bloqueado
{ const r = c({ boletos: [{ id_recebimento: '1', dias_atraso: 12, valor_total: 500, valor_corrigido: 505, em_processo: false, em_acordo: false }] });
  ok(r.balde === 'nenhum' && !r.elegivel, `só boleto <30d -> nenhum/não-elegível (${r.balde})`); }

// 3) judicial (unidade) → BLOQUEADO judicial
{ const r = c({ no_juridico: true }); ok(r.balde === 'bloqueado' && r.motivos.includes('judicial'), `no_juridico -> bloqueado/judicial (${r.motivos})`); }

// 3b) todos os boletos em processo → BLOQUEADO judicial (mesmo sem flag de unidade)
{ const r = c({ no_juridico: false, boletos: [{ id_recebimento: '1', dias_atraso: 90, valor_total: 500, valor_corrigido: 640, em_processo: true, em_acordo: false }] });
  ok(r.balde === 'bloqueado' && r.motivos.includes('judicial'), `todos boletos em_processo -> bloqueado/judicial (${r.motivos})`); }

// 4) garantidora total → BLOQUEADO garantidora
{ const r = c({ garantidora: { tipo: 'total' } }); ok(r.balde === 'bloqueado' && r.motivos.includes('garantidora'), `garantidora total -> bloqueado/garantidora (${r.motivos})`); }

// 4b) garantidora 'allure' (exceção: NCS gera boleto) → NÃO bloqueia por garantidora
{ const r = c({ garantidora: { tipo: 'allure' } }); ok(r.balde !== 'bloqueado' || !r.motivos.includes('garantidora'), `garantidora allure -> não bloqueia por garantidora (${r.balde}/${r.motivos})`); }

// 5) todos os boletos em acordo → BLOQUEADO ja_em_acordo
{ const r = c({ boletos: [{ id_recebimento: '1', dias_atraso: 90, valor_total: 500, valor_corrigido: 640, em_processo: false, em_acordo: true }] });
  ok(r.balde === 'bloqueado' && r.motivos.includes('ja_em_acordo'), `todos em acordo -> bloqueado/ja_em_acordo (${r.motivos})`); }

// 6) sem e-mail (mas com débito elegível) → BLOQUEADO sem_email
{ const r = c({ email: '' }); ok(r.balde === 'bloqueado' && r.motivos.includes('sem_email'), `sem email -> bloqueado/sem_email (${r.motivos})`); }
{ const r = c({ email: 'invalido' }); ok(r.balde === 'bloqueado' && r.motivos.includes('sem_email'), `email inválido -> bloqueado/sem_email (${r.motivos})`); }

// 7) valor corrigido alto (> mult × taxa) → REVISAR valor_alto
{ const r = c({ boletos: [{ id_recebimento: '1', dias_atraso: 120, valor_total: 3000, valor_corrigido: 4200, em_processo: false, em_acordo: false }] }, { taxaMensal: 800, valorAltoMult: 3 });
  ok(r.balde === 'revisar' && r.motivos.includes('valor_alto'), `valor 4200 > 3x800 -> revisar/valor_alto (${r.balde}/${r.motivos})`); }

// 7b) sem taxaMensal informada → não classifica por valor (não vira revisar por isso)
{ const r = c({ boletos: [{ id_recebimento: '1', dias_atraso: 120, valor_total: 3000, valor_corrigido: 4200, em_processo: false, em_acordo: false }] }, {});
  ok(r.balde === 'pronto', `valor alto sem taxaMensal -> pronto (não inventa limite) (${r.balde})`); }

// 8) interação recente no CRM → REVISAR interacao_recente
{ const r = c({ ultimo_contato_dias: 5 }, { revisarInteracaoDias: 15 }); ok(r.balde === 'revisar' && r.motivos.includes('interacao_recente'), `contato há 5d -> revisar/interacao_recente (${r.motivos})`); }

// 9) bounce anterior → REVISAR bounce
{ const r = c({ bounce_anterior: true }); ok(r.balde === 'revisar' && r.motivos.includes('bounce'), `bounce anterior -> revisar/bounce (${r.motivos})`); }

// 10) precedência: bloqueio ganha de revisar (judicial + valor alto → bloqueado)
{ const r = c({ no_juridico: true, ultimo_contato_dias: 2 }); ok(r.balde === 'bloqueado', `judicial + interação recente -> bloqueado (bloqueio precede) (${r.balde})`); }

// 11) valor_corrigido só conta boletos ELEGÍVEIS (>=30d, não judicial/acordo)
{ const r = c({ boletos: [
    { id_recebimento: '1', dias_atraso: 90, valor_total: 500, valor_corrigido: 640, em_processo: false, em_acordo: false },
    { id_recebimento: '2', dias_atraso: 10, valor_total: 500, valor_corrigido: 505, em_processo: false, em_acordo: false }, // <30d, não conta
  ] });
  ok(r.valor_corrigido === 640, `valor_corrigido só soma elegíveis (=640, não 1145) (${r.valor_corrigido})`); }

// 12) classificarLeva agrega e separa
{ const leva = classificarLeva([
    uni({ id_unidade: 'A' }),                          // pronto
    uni({ id_unidade: 'B', no_juridico: true }),       // bloqueado
    uni({ id_unidade: 'C', bounce_anterior: true }),   // revisar
    uni({ id_unidade: 'D', boletos: [{ id_recebimento: '1', dias_atraso: 5, valor_total: 100, valor_corrigido: 101, em_processo: false, em_acordo: false }] }), // nenhum
  ]);
  ok(leva.prontos.length === 1 && leva.revisar.length === 1 && leva.bloqueados.length === 1,
    `leva -> 1 pronto / 1 revisar / 1 bloqueado (${leva.prontos.length}/${leva.revisar.length}/${leva.bloqueados.length})`);
  ok(leva.totais.prontos === 1 && typeof leva.totais.valor_prontos === 'number', `leva.totais presente (valor_prontos=${leva.totais.valor_prontos})`);
  ok(leva.ignorados.length === 1, `leva.ignorados (nenhum) = 1 (${leva.ignorados.length})`); }

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(falhas ? 1 : 0);
