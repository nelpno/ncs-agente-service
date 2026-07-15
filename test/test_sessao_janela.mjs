// test_sessao_janela.mjs — janela de continuidade da sessão.
//
// POR QUE ISTO EXISTE (caso real, 15/07/2026, conv 94→95):
// a memória da Ana vive por CONTATO, não por ticket. Sem janela, um morador que volta 2 dias
// depois traria o histórico inteiro (assunto velho contaminando + tokens à toa). Com janela,
// silêncio longo = assunto novo = sessão limpa; volta em 30s = continua de onde parou.
//
// Roda SEM REDIS_URL → exercita o fallback Map. O parâmetro é opcional: sem ele, o
// comportamento é EXATAMENTE o de hoje (nenhum chamador existente muda de comportamento).
// Uso: node test/test_sessao_janela.mjs

delete process.env.REDIS_URL;

import { getSession, saveSession } from '../src/memory.mjs';

let failures = 0;
function assert(condition, label) {
  if (condition) console.log('  OK  ', label);
  else { console.error('  FAIL', label); failures++; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('\n=== test_sessao_janela.mjs ===\n');

// 1. Sem maxIdleMs → comportamento de HOJE (nada muda para quem não pediu a janela)
{
  const s = await getSession('j-default');
  s.messages.push({ role: 'user', content: 'oi' });
  await saveSession('j-default', s);
  await sleep(5);
  const s2 = await getSession('j-default');
  assert(s2.messages.length === 1, 'sem janela → sessão preservada (comportamento atual intacto)');
}

// 2. Dentro da janela → CONTINUA (o caso do print: "Sim da outra também" 29s depois)
{
  const s = await getSession('j-dentro');
  s.messages.push({ role: 'user', content: '2 via de boleto' });
  s.ctx.lastCondo = { id: '191', nome: 'ALTO DA BOA VISTA' };
  await saveSession('j-dentro', s);
  await sleep(5);
  const s2 = await getSession('j-dentro', { maxIdleMs: 60 * 60 * 1000 }); // 60 min
  assert(s2.messages.length === 1, 'dentro da janela → lembra o histórico');
  assert(s2.ctx.lastCondo?.id === '191', 'dentro da janela → lembra o ctx (condomínio)');
}

// 3. Fora da janela → começa LIMPA (assunto novo, sem arrastar o velho)
{
  const s = await getSession('j-fora');
  s.messages.push({ role: 'user', content: 'assunto de anteontem' });
  s.ctx.lastCondo = { id: '179', nome: 'LUME' };
  await saveSession('j-fora', s);
  await sleep(15);
  const s2 = await getSession('j-fora', { maxIdleMs: 10 }); // parada há mais de 10ms
  assert(s2.messages.length === 0, 'fora da janela → histórico limpo');
  assert(Object.keys(s2.ctx).length === 0, 'fora da janela → ctx limpo');
}

// 4. Fora da janela: o save seguinte NÃO ressuscita o histórico velho
{
  const s = await getSession('j-persist');
  s.messages.push({ role: 'user', content: 'velho' });
  await saveSession('j-persist', s);
  await sleep(15);
  const s2 = await getSession('j-persist', { maxIdleMs: 10 });
  s2.messages.push({ role: 'user', content: 'novo' });
  await saveSession('j-persist', s2);
  const s3 = await getSession('j-persist', { maxIdleMs: 60 * 60 * 1000 });
  assert(s3.messages.length === 1 && s3.messages[0].content === 'novo',
    'após expirar, a sessão nova substitui a velha (sem ressurreição)');
}

console.log('\n' + (failures === 0 ? '✓ Todos os testes passaram.' : `✗ ${failures} teste(s) FALHARAM.`) + '\n');
process.exit(failures > 0 ? 1 : 0);
