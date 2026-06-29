// test_kv.mjs — KV genérico (fallback Map quando sem Redis)
import { kvSet, kvGet, kvDel } from '../src/memory.mjs';
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

await kvSet('kvt:1', { a: 1 }, 60);
const v = await kvGet('kvt:1');
ok(v && v.a === 1, 'kvSet/kvGet round-trip');
await kvDel('kvt:1');
ok((await kvGet('kvt:1')) === null, 'kvDel remove');
ok((await kvGet('kvt:inexistente')) === null, 'miss retorna null');

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
