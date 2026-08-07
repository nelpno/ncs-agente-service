// test_cobranca_parametros.mjs — os percentuais da cobrança são DECISÃO DO CLIENTE, não do LLM.
//
// A planilha do Fernando (05-06/08/2026) diz, por condomínio, se a Ana pode cobrar e com quanto de
// juros/multa/honorário. Este teste trava as três coisas que, se saírem erradas, viram dinheiro
// cobrado a mais de um morador:
//   1. condomínio fora da base NÃO recebe percentual nenhum (nem "o de sempre");
//   2. condomínio que o cliente marcou como "não" NÃO devolve percentual — devolve para quem encaminhar;
//   3. a janela de dias (Atlanta 60, Tivoli 90) é campo próprio, não booleano.
import {
  consultar_parametros_cobranca, _reloadIndex, _percentualComoTexto,
} from '../src/cobranca_parametros.mjs';

let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

// ── fixture injetada: o teste não depende do dado de produção mudar ──────────
const FIX = {
  condominios: [
    { nome: 'CONDOMINIO TESTE LIBERADO', slug: 'condominio-teste-liberado', cnpj: '00.000.000/0001-91',
      pode_cobrar: true, janela_dias: null, juros_mes: 0.01, multa: 0.02,
      honorarios_automatico: true, honorarios_pct: 0.1, parcelamento_max: '2x',
      responsavel: 'Cobrança NCS', judicial_responsavel: null, contato_externo: null, observacao_fernando: null },
    { nome: 'CONDOMINIO TESTE COM JANELA', slug: 'condominio-teste-com-janela', cnpj: null,
      pode_cobrar: true, janela_dias: 60, juros_mes: 0.01, multa: 0.02,
      honorarios_automatico: false, honorarios_pct: 0, parcelamento_max: null,
      responsavel: 'ESCRITORIO X', judicial_responsavel: 'ESCRITORIO X', contato_externo: 'x@adv.br', observacao_fernando: null },
    { nome: 'CONDOMINIO TESTE BLOQUEADO', slug: 'condominio-teste-bloqueado', cnpj: null,
      pode_cobrar: false, janela_dias: null, juros_mes: null, multa: null,
      honorarios_automatico: null, honorarios_pct: null, parcelamento_max: null,
      responsavel: 'ESCRITORIO Y', judicial_responsavel: 'ESCRITORIO Y', contato_externo: 'y@adv.br', observacao_fernando: null },
    { nome: 'CONDOMINIO TESTE EM BRANCO', slug: 'condominio-teste-em-branco', cnpj: null,
      pode_cobrar: null, janela_dias: null, juros_mes: null, multa: null,
      honorarios_automatico: null, honorarios_pct: null, parcelamento_max: null,
      responsavel: null, judicial_responsavel: null, contato_externo: null, observacao_fernando: 'esse nao entendi' },
    // dois nomes que colidem: ambiguidade legítima tem de CONTINUAR ambígua
    { nome: 'JARDIM CEDROS UM', slug: 'jardim-cedros-um', pode_cobrar: true, janela_dias: null,
      juros_mes: 0.01, multa: 0.02, honorarios_automatico: true, honorarios_pct: 0.1, parcelamento_max: '2x' },
    { nome: 'JARDIM CEDROS DOIS', slug: 'jardim-cedros-dois', pode_cobrar: true, janela_dias: null,
      juros_mes: 0.01, multa: 0.02, honorarios_automatico: true, honorarios_pct: 0.1, parcelamento_max: '2x' },
  ],
};
_reloadIndex(FIX);

// ── 1. condomínio liberado ───────────────────────────────────────────────────
const lib = consultar_parametros_cobranca({ condominio: 'Condominio Teste Liberado' });
ok(lib.encontrou === true, 'acha o condomínio liberado');
ok(lib.pode_cobrar === true, 'pode_cobrar = true');
ok(lib.juros_mes === 0.01 && lib.multa === 0.02, 'devolve juros 1% e multa 2%');
ok(lib.honorarios_pct === 0.1, 'devolve honorários 10%');
ok(lib.parcelamento_max === '2x', 'devolve o parcelamento máximo');
ok(/1%/.test(lib.resumo) && /2%/.test(lib.resumo), 'o resumo traz os percentuais em % legível');

// ── 2. quem o cliente BLOQUEOU não recebe percentual ─────────────────────────
// Esta é a que mais importa: se vazar percentual aqui, a Ana negocia onde não pode.
const blo = consultar_parametros_cobranca({ condominio: 'Condominio Teste Bloqueado' });
ok(blo.encontrou === true, 'acha o condomínio bloqueado');
ok(blo.pode_cobrar === false, 'pode_cobrar = false');
ok(blo.juros_mes == null && blo.multa == null && blo.honorarios_pct == null,
  'BLOQUEADO: nenhum percentual é devolvido');
ok(blo.encaminhar_para === 'ESCRITORIO Y', 'diz para quem encaminhar');
ok(!/%/.test(blo.resumo || ''), 'o resumo do bloqueado não cita percentual nenhum');

// ── 3. em branco na planilha = trata como NÃO pode (falha fechada) ───────────
const br = consultar_parametros_cobranca({ condominio: 'Condominio Teste Em Branco' });
ok(br.pode_cobrar === false, 'coluna em branco => NÃO pode cobrar (nunca assume que pode)');
ok(br.juros_mes == null, 'em branco não devolve percentual');
ok(br.motivo_bloqueio === 'sem_decisao_na_planilha', 'diz que falta a decisão do cliente');

// ── 4. janela de dias é campo próprio ────────────────────────────────────────
const jan = consultar_parametros_cobranca({ condominio: 'Condominio Teste Com Janela' });
ok(jan.janela_dias === 60, 'janela de 60 dias preservada');
ok(/60 dias/.test(jan.resumo), 'o resumo avisa da janela');
ok(lib.janela_dias === null, 'sem janela declarada = null (não vira 0)');

// ── 5. condomínio fora da base: NUNCA inventa ────────────────────────────────
const fora = consultar_parametros_cobranca({ condominio: 'Condominio Que Nao Existe' });
ok(fora.encontrou === false, 'condomínio fora da base: encontrou=false');
ok(fora.juros_mes === undefined && fora.multa === undefined,
  'fora da base NÃO devolve percentual (nem o "padrão de todo mundo")');
ok(fora.motivo === 'condominio_sem_parametro_cobranca', 'motivo explícito');

// ── 6. ambiguidade continua ambígua ──────────────────────────────────────────
const amb = consultar_parametros_cobranca({ condominio: 'Jardim Cedros' });
ok(amb.encontrou === false && amb.motivo === 'condominio_ambiguo', 'nome ambíguo não escolhe sozinho');
ok(Array.isArray(amb.candidatos) && amb.candidatos.length === 2, 'lista os candidatos');

// ── 7. sem condomínio informado ──────────────────────────────────────────────
ok(consultar_parametros_cobranca({}).motivo === 'condominio_nao_informado', 'sem condomínio: pede o nome');

// ── 8. formatação de percentual (0.01 -> "1%") ───────────────────────────────
ok(_percentualComoTexto(0.01) === '1%', '0.01 vira 1%');
ok(_percentualComoTexto(0.02) === '2%', '0.02 vira 2%');
ok(_percentualComoTexto(0.1) === '10%', '0.1 vira 10%');
ok(_percentualComoTexto(0) === '0%', '0 vira 0% (e não some)');
ok(_percentualComoTexto(null) === null, 'null continua null');

// ── 9. o DADO REAL de produção respeita as invariantes ───────────────────────
// (fixture prova o mecanismo; isto prova que a planilha do cliente não tem buraco perigoso)
_reloadIndex(null); // volta ao arquivo real
const real = JSON.parse(
  (await import('node:fs')).readFileSync(
    new URL('../data/cobranca/parametros.json', import.meta.url), 'utf8'));
const lista = real.condominios;
ok(lista.length >= 55, `dado real carregado (${lista.length} condomínios)`);
const vazando = lista.filter((c) => !c.pode_cobrar && (c.juros_mes != null || c.multa != null || c.honorarios_pct != null));
ok(vazando.length === 0, `nenhum condomínio bloqueado carrega percentual (${vazando.map((c) => c.nome).join(', ') || 'ok'})`);
const semPct = lista.filter((c) => c.pode_cobrar && (c.juros_mes == null || c.multa == null));
ok(semPct.length === 0, `todo condomínio liberado tem juros e multa (${semPct.map((c) => c.nome).join(', ') || 'ok'})`);
const jurosEstranho = [...new Set(lista.filter((c) => c.juros_mes != null).map((c) => c.juros_mes))];
ok(jurosEstranho.length === 1 && jurosEstranho[0] === 0.01, `juros uniforme 1% (achado: ${jurosEstranho})`);

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
