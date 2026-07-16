// test_docia_card.mjs — o laudo do DocIA na tela de quem APROVA.
//
// O que está em jogo aqui não é layout: é o que o aprovador lê antes de clicar. Duas regras que o
// card não pode violar, porque as duas ensinam a pessoa a confiar errado:
//   1. check verde NÃO entra em `alertas[]` — aquele canal quer dizer "atenção, faça isto". Enchê-lo
//      de OK faz o aprovador passar o olho por cima e perder o alerta que importa (o flip do
//      proprietário, que evita boleto duplicado).
//   2. `confianca` não vai para a tela — número sem calibração lê como certeza.
// E o principal: SEM laudo o card tem que ficar idêntico ao de hoje (é o que torna o deploy seguro).

import assert from 'node:assert/strict';
import { cadastroInquilino } from '../src/write/actions/cadastro_inquilino.mjs';

let ok = 0;
const t = (nome, fn) => { try { fn(); console.log('  ok  ' + nome); ok++; } catch (e) { console.error('  FALHOU  ' + nome + '\n      ' + e.message); process.exitCode = 1; } };

const BASE = {
  id_condominio: '179', id_unidade: '14381', unidade_label: 'APTO 101 / BLOCO A',
  condominio_nome: 'LUME', nome: 'Maria Souza', papel: 'inquilino', data_entrada: '10/05/2026',
};
const laudo = (over = {}) => ({
  parecer: 'pendente', confianca: 0.72,
  conferencias: [
    { item: 'locatario', status: 'ok', evidencia: 'Maria Souza' },
    { item: 'unidade', status: 'ok', evidencia: 'apto 101' },
    { item: 'assinatura', status: 'pendente', evidencia: 'não localizei a assinatura do locatário' },
    { item: 'maioridade', status: 'nao_verificavel', evidencia: 'o contrato não traz data de nascimento' },
  ],
  pendencias: ['não localizei a assinatura do locatário'],
  divergencias: [],
  ...over,
});
const render = (d) => cadastroInquilino.render(d, []);
const txt = (r) => JSON.stringify(r);

console.log('\n[1] sem laudo, o card é o de sempre');

t('sem contrato → nenhuma linha de DocIA (card idêntico ao de hoje)', () => {
  const r = render({ ...BASE });
  assert.ok(!txt(r).includes('DocIA'), 'apareceu DocIA num cadastro sem contrato');
  assert.deepEqual(r.alertas, [], 'cadastro simples não pode ganhar alerta do nada');
  assert.equal(r.campos.length, 9, 'o card sem laudo mudou de tamanho');
});

t('sem contrato, o resumo não ganha selo', () => {
  assert.ok(!render({ ...BASE }).resumo.includes('Contrato conferido'));
});

console.log('\n[2] com laudo, o que o aprovador lê');

t('o parecer entra no resumo', () => {
  assert.ok(render({ ...BASE, laudo: laudo() }).resumo.includes('Contrato conferido: 1 item a resolver'));
});

t('a pendência entra em alertas[]', () => {
  const r = render({ ...BASE, laudo: laudo() });
  assert.ok(r.alertas.some((a) => a.includes('não localizei a assinatura')), 'a pendência sumiu da tela');
});

t('a divergência também entra em alertas[]', () => {
  const r = render({ ...BASE, laudo: laudo({ divergencias: ['o CPF do contrato não bate com o informado'], pendencias: [] }) });
  assert.ok(r.alertas.some((a) => a.includes('CPF do contrato não bate')));
});

t('REGRA 1: check verde NUNCA entra em alertas[]', () => {
  const r = render({ ...BASE, laudo: laudo({ parecer: 'aprovado', pendencias: [], divergencias: [] }) });
  assert.deepEqual(r.alertas, [], 'contrato 100% OK gerou alerta — o canal de atenção virou ruído');
});

t('os OK viram UMA linha em campos[], contados', () => {
  const r = render({ ...BASE, laudo: laudo() });
  const c = r.campos.find((x) => /DocIA/.test(x.label));
  assert.ok(c, 'faltou a linha de conferência no card');
  assert.ok(/2 conferências OK/.test(c.valor), 'a contagem de OK saiu errada: ' + c.valor);
});

t('"não verificável" é dito em voz alta (silenciar = ok por omissão)', () => {
  const c = render({ ...BASE, laudo: laudo() }).campos.find((x) => /DocIA/.test(x.label));
  assert.ok(/não verificável/.test(c.valor), 'o não-verificável sumiu: ' + c.valor);
});

t('REGRA 2: a confiança NÃO aparece na tela', () => {
  const r = render({ ...BASE, laudo: laudo() });
  assert.ok(!txt(r).includes('0.72') && !txt(r).includes('72%'), 'vazou a confiança (número sem calibração) p/ a tela');
});

t('reprovado fala com o aprovador, sem jargão', () => {
  const r = render({ ...BASE, laudo: laudo({ parecer: 'reprovado' }) });
  assert.ok(/REPROVADO/.test(r.resumo), 'reprovado não apareceu no resumo');
});

console.log('\n[3] o alerta que evita boleto duplicado não pode ser abafado');

t('o flip do proprietário continua, e vem ANTES do contrato', () => {
  const d = { ...BASE, responsavel_cobranca: 'inquilino', laudo: laudo() };
  const r = render(d);
  assert.ok(/só cobranças extras/.test(r.alertas[0]), 'o alerta de duplicação perdeu o topo p/ o contrato');
  assert.equal(r.alertas.length, 2, 'esperado: flip + 1 pendência do contrato');
});

t('o laudo NÃO vaza para o payload do Superlógica', () => {
  // montarPayload monta campo a campo; este teste é o cinto: se alguém trocar por um spread do `d`,
  // o laudo inteiro (com PII do contrato) iria parar num PUT do ERP.
  const p = cadastroInquilino.montarPayload({ ...BASE, laudo: laudo() });
  assert.ok(!JSON.stringify(p).includes('conferencias'), 'o laudo vazou p/ o payload do ERP');
});

console.log(`\n${ok} verdes` + (process.exitCode ? ' — COM FALHA' : ''));
