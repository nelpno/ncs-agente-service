// test_cobranca_normalizar.mjs — normalizador: resposta CRUA do inadimplencia/index (detalhe) → shape do classificador.
// Fixture no shape REAL da resposta (capturado no probe 18/07, condo 191) — NÃO do payload de escrita (o erro que
// cegou a duplicata do cadastro). Determinístico, sem API/PII real. Exit 1 em qualquer falha.
import { normalizarUnidade, extrairContato } from '../src/cobranca/inadimplentes.mjs';
import { classificarUnidade } from '../src/cobranca/inadimplentes.mjs';

let falhas = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK ' : 'FALHA'} ${msg}`); if (!cond) falhas++; };

// --- fixture: 1 unidade do inadimplencia/index detalhe (campos reais do probe) ---
const detalhe = {
  id_unidade_uni: '16346', st_unidade_uni: '101', st_bloco_uni: 'A',
  id_condominio_cond: '181', nome_formatado: 'Apto 101 Bloco A', saldo_juridico: '0',
  processos: [],
  recebimento: [
    { id_recebimento_recb: '1', dt_vencimento_recb: '10/20/2019 00:00:00', vl_total_recb: '110.27',
      id_processo_proc: '', id_acordo_recb: '',
      encargos: [{ detalhes: { atualizacaomonetaria: '50.92', juros: '123.15', multa: '3.22' }, taxas: { juros: '1.00', multa: '2.00' }, valorcorrigido: '287.56', diasatraso: '2463' }] },
    { id_recebimento_recb: '2', dt_vencimento_recb: '01/10/2026 00:00:00', vl_total_recb: '500.00',
      id_processo_proc: '', id_acordo_recb: '',
      encargos: [{ detalhes: { atualizacaomonetaria: '0', juros: '5', multa: '10' }, taxas: { juros: '1.00', multa: '2.00' }, valorcorrigido: '515.00', diasatraso: '8' }] },
    { id_recebimento_recb: '3', dt_vencimento_recb: '05/10/2019 00:00:00', vl_total_recb: '300.00',
      id_processo_proc: '9988', id_acordo_recb: '',
      encargos: [{ detalhes: { atualizacaomonetaria: '10', juros: '80', multa: '6' }, taxas: { juros: '1.00', multa: '2.00' }, valorcorrigido: '396.00', diasatraso: '2600' }] },
    { id_recebimento_recb: '4', dt_vencimento_recb: '06/10/2019 00:00:00', vl_total_recb: '200.00',
      id_processo_proc: '', id_acordo_recb: '555',
      encargos: [{ detalhes: { atualizacaomonetaria: '5', juros: '40', multa: '4' }, taxas: { juros: '1.00', multa: '2.00' }, valorcorrigido: '249.00', diasatraso: '2570' }] },
  ],
};
// contato vem do RESUMO (no detalhe o email/CPF NÃO estão no top-level) — campos reais: st_email_con etc.
const resumoRow = { id_unidade_uni: '16346', st_email_con: 'morador@exemplo.com', st_cpf_con: '11122233344', st_nome_con: 'Fulano de Tal' };

// 1) extrairContato mapeia os nomes de campo REAIS da resposta
{ const ct = extrairContato(resumoRow);
  ok(ct.email === 'morador@exemplo.com' && ct.cpf === '11122233344' && ct.nome === 'Fulano de Tal',
    `extrairContato -> email/cpf/nome dos campos st_*_con (${JSON.stringify(ct)})`); }

// 1b) MÚLTIPLOS e-mails no st_email_con (separados por ';' — real: uni 16348 condo 191, 3 e-mails).
// email = 1º VÁLIDO; emails = todos os válidos. NÃO pode virar "sem e-mail" (era falso bloqueio).
{ const ct = extrairContato({ st_email_con: 'primeiro@x.com;segundo@y.com; terceiro@z.com' });
  ok(ct.email === 'primeiro@x.com', `multi-email -> email = 1º válido (${ct.email})`);
  ok(Array.isArray(ct.emails) && ct.emails.length === 3, `multi-email -> emails[] com os 3 (${(ct.emails || []).length})`); }
// 1c) mistura de lixo + válido → pega o 1º VÁLIDO, ignora o lixo
{ const ct = extrairContato({ st_email_con: 'semarroba ; bom@y.com' });
  ok(ct.email === 'bom@y.com' && ct.emails.length === 1, `lixo+válido -> email = bom@y.com, emails=1 (${ct.email}/${ct.emails.length})`); }
// 1d) vazio → email null, emails []
{ const ct = extrairContato({ st_email_con: '' });
  ok(ct.email === null && Array.isArray(ct.emails) && ct.emails.length === 0, `vazio -> email null, emails [] (${ct.email}/${ct.emails.length})`); }
// 1e) unidade com multi-email NÃO vira bloqueado/sem_email no classificador
{ const u = normalizarUnidade({ id_unidade_uni: 'Z', id_condominio_cond: '181', processos: [],
    recebimento: [{ id_recebimento_recb: '1', vl_total_recb: '500', id_processo_proc: '', id_acordo_recb: '',
      encargos: [{ detalhes: { juros: '1', multa: '1', atualizacaomonetaria: '0' }, valorcorrigido: '600', diasatraso: '90' }] }] },
    { ...extrairContato({ st_email_con: 'a@x.com;b@y.com' }) });
  const r = classificarUnidade(u);
  ok(r.balde !== 'bloqueado' || !r.motivos.includes('sem_email'), `multi-email -> NÃO é sem_email (${r.balde}/${r.motivos})`); }

// 2) normalizarUnidade: identidade + condominio
{ const u = normalizarUnidade(detalhe, { email: 'morador@exemplo.com' });
  ok(u.id_unidade === '16346' && u.condominio_id === 181, `identidade -> id 16346, condo 181 (${u.id_unidade}/${u.condominio_id})`);
  ok(/101/.test(u.unidade_label), `unidade_label tem o número (${u.unidade_label})`); }

// 3) boletos mapeados (todos os 4) com valores numéricos
{ const u = normalizarUnidade(detalhe, {});
  ok(u.boletos.length === 4, `4 boletos mapeados (${u.boletos.length})`);
  const b0 = u.boletos[0];
  ok(b0.dias_atraso === 2463 && b0.valor_total === 110.27 && b0.valor_corrigido === 287.56,
    `boleto[0] -> dias 2463, total 110.27, corrigido 287.56 (${b0.dias_atraso}/${b0.valor_total}/${b0.valor_corrigido})`);
  ok(typeof b0.dias_atraso === 'number' && typeof b0.valor_corrigido === 'number', 'boleto[0] valores são number (não string)'); }

// 4) em_processo / em_acordo derivados dos ids (string vazia = false)
{ const u = normalizarUnidade(detalhe, {});
  ok(u.boletos[0].em_processo === false && u.boletos[0].em_acordo === false, `boleto[0] -> não judicial, não acordo`);
  ok(u.boletos[2].em_processo === true, `boleto[3] (id_processo_proc=9988) -> em_processo true (${u.boletos[2].em_processo})`);
  ok(u.boletos[3].em_acordo === true, `boleto[4] (id_acordo_recb=555) -> em_acordo true (${u.boletos[3].em_acordo})`); }

// 5) no_juridico vem de processos[] (unidade), independente do id_processo_proc por-boleto
{ const u = normalizarUnidade(detalhe, {});
  ok(u.no_juridico === false, `processos[] vazio -> no_juridico false (${u.no_juridico})`);
  const uJur = normalizarUnidade({ ...detalhe, processos: [{ fl_status_proc: 6 }] }, {});
  ok(uJur.no_juridico === true, `processos[] com item -> no_juridico true (${uJur.no_juridico})`); }

// 6) extras passam através (garantidora, ultimo_contato_dias, bounce_anterior)
{ const u = normalizarUnidade(detalhe, { email: 'm@x.com', garantidora: { tipo: 'total' }, ultimo_contato_dias: 3, bounce_anterior: true });
  ok(u.garantidora?.tipo === 'total' && u.ultimo_contato_dias === 3 && u.bounce_anterior === true, `extras passam através`); }

// 7) ponta-a-ponta: normalizar → classificar = PRONTO (tem boleto[0] elegível +30d não-judicial, email ok)
{ const u = normalizarUnidade(detalhe, { email: 'morador@exemplo.com' });
  const r = classificarUnidade(u);
  // elegíveis = boleto[0] (2463d, não jud/acordo). boleto[1]=<30d, [2]=judicial, [3]=acordo → fora
  ok(r.balde === 'pronto' && r.qtd_boletos === 1 && r.valor_corrigido === 287.56,
    `normalizar+classificar -> pronto, 1 boleto elegível, R$287.56 (${r.balde}/${r.qtd_boletos}/${r.valor_corrigido})`); }

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(falhas ? 1 : 0);
