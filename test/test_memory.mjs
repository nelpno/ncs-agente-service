// test_memory.mjs — testa o fallback in-memory da memória de sessão (sem Redis real).
// Executa SEM REDIS_URL → exercita 100% o Map interno.
// Uso: node test/test_memory.mjs

// garantir que REDIS_URL não vaze do ambiente
delete process.env.REDIS_URL;

import { getSession, saveSession, resetSession } from '../src/memory.mjs';

let failures = 0;
function assert(condition, label) {
  if (condition) {
    console.log('  OK  ', label);
  } else {
    console.error('  FAIL', label);
    failures++;
  }
}

console.log('\n=== test_memory.mjs (fallback in-memory) ===\n');

// 1. getSession numa key nova retorna objeto vazio
const s1 = await getSession('k1');
assert(Array.isArray(s1.messages) && s1.messages.length === 0, 'getSession nova → messages vazio');
assert(typeof s1.ctx === 'object' && s1.ctx !== null, 'getSession nova → ctx objeto');
assert(typeof s1.touched === 'number', 'getSession nova → touched número');

// 2. muta o objeto (simula handleTurn que faz push por referência)
s1.messages.push({ role: 'user', content: 'oi' });
s1.ctx.condo = 'Lume';

// 3. saveSession persiste no Map
await saveSession('k1', s1);

// 4. novo getSession reflete a persistência
const s2 = await getSession('k1');
assert(s2.messages.length === 1, 'após save: messages.length === 1');
assert(s2.messages[0].content === 'oi', 'após save: messages[0].content === "oi"');
assert(s2.ctx.condo === 'Lume', 'após save: ctx.condo === "Lume"');

// 5. round-trip de serialização (JSON stringify / parse)
const raw = JSON.stringify({ messages: s2.messages, ctx: s2.ctx, touched: s2.touched });
const parsed = JSON.parse(raw);
assert(parsed.messages[0].role === 'user', 'round-trip JSON: role preservado');
assert(parsed.ctx.condo === 'Lume', 'round-trip JSON: ctx preservado');
assert(typeof parsed.touched === 'number', 'round-trip JSON: touched número');

// 6. resetSession apaga a sessão
await resetSession('k1');
const s3 = await getSession('k1');
assert(s3.messages.length === 0, 'após reset: messages vazio');
assert(Object.keys(s3.ctx).length === 0, 'após reset: ctx vazio');

// 7. keys independentes não interferem
const sA = await getSession('sessA');
const sB = await getSession('sessB');
sA.messages.push({ role: 'user', content: 'A' });
await saveSession('sessA', sA);
const sA2 = await getSession('sessA');
const sB2 = await getSession('sessB');
assert(sA2.messages.length === 1, 'keys independentes: sessA tem 1 msg');
assert(sB2.messages.length === 0, 'keys independentes: sessB ainda vazia');

// 8. touched é atualizado no save
const before = Date.now();
await new Promise(r => setTimeout(r, 5)); // pausa mínima
const sT = await getSession('t1');
await saveSession('t1', sT);
const sT2 = await getSession('t1');
assert(sT2.touched >= before, 'touched atualizado no save');

console.log('\n' + (failures === 0 ? '✓ Todos os testes passaram.' : `✗ ${failures} teste(s) FALHARAM.`) + '\n');
process.exit(failures > 0 ? 1 : 0);
