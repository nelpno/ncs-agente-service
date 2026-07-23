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

// Cadastro COMPLETO: é o caso normal depois que a Ana passou a pedir CPF/e-mail/telefone (15/07).
// Os testes de "falta dado" abaixo derivam daqui tirando o campo — assim, o dia em que um deles virar
// obrigatório, é o teste específico que fala, não um assert de alertas vazios em outro lugar.
const BASE = {
  id_condominio: '179', id_unidade: '14381', unidade_label: 'APTO 101 / BLOCO A',
  condominio_nome: 'LUME', nome: 'Maria Souza', papel: 'inquilino', data_entrada: '10/05/2026',
  cpf: '12345678901', email: 'maria@email.com', telefone: '16991234567',
};
const sem = (campo) => { const d = { ...BASE }; delete d[campo]; return d; };
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

console.log('\n[3] e-mail e telefone: OBRIGATÓRIOS p/ inquilino, lenientes p/ dependente (Fernando, 22/07)');

// O card ainda mostra o alerta quando falta e-mail/telefone (render é desacoplado do validar): cobre o
// DEPENDENTE (leniente, pode chegar sem eles) e é rede de segurança. Sem laudo, render(sem(...)) segue produzindo o aviso.
t('sem e-mail → alerta (é para onde o boleto é enviado)', () => {
  const r = render(sem('email'));
  assert.ok(r.alertas.some((a) => /e-mail/i.test(a) && /boleto/i.test(a)), 'faltou avisar que sem e-mail o boleto não é enviado');
});

t('sem telefone → alerta (entra no sistema da portaria)', () => {
  assert.ok(render(sem('telefone')).alertas.some((a) => /telefone/i.test(a)), 'faltou avisar do telefone');
});

t('com e-mail e telefone → nenhum alerta desses (sem ruído)', () => {
  assert.ok(!render(BASE).alertas.some((a) => /e-mail|telefone/i.test(a)), 'alertou sobre dado que está lá');
});

t('e-mail/telefone TRAVAM o rascunho de INQUILINO (Fernando reverteu em 22/07 a graduação de 15/07)', () => {
  // 22/07: "e-mail e telefone celular OBRIGATÓRIOS". A Ana COLETA na conversa (o card chega completo);
  // sem eles ela PEDE, não manda rascunho pela metade. Ver [[ncs-onda-c-titularidade-dry]]. Antes disto
  // o teste exigia o OPOSTO — a trilha da decisão custou uma sessão em 14/07; não reverter de novo.
  assert.equal(cadastroInquilino.validar(sem('email')).ok, false, 'inquilino sem e-mail NÃO pode passar');
  assert.equal(cadastroInquilino.validar(sem('telefone')).ok, false, 'inquilino sem telefone NÃO pode passar');
  assert.equal(cadastroInquilino.validar(sem('cpf')).ok, false, 'sem CPF o rascunho NÃO pode passar');
});

t('DEPENDENTE segue leniente: sem e-mail/telefone/CPF → passa (menor não obriga)', () => {
  const dep = { id_condominio: BASE.id_condominio, id_unidade: BASE.id_unidade, nome: 'Filho Menor', papel: 'dependente', data_entrada: BASE.data_entrada };
  assert.equal(cadastroInquilino.validar(dep).ok, true, 'dependente sem os dados extras tem que passar');
});

console.log('\n[4] o alerta que evita boleto duplicado não pode ser abafado');

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
