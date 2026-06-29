// test_auditoria.mjs — log append-only durável
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = path.join(os.tmpdir(), `audit_${Date.now()}.jsonl`);
process.env.AUDIT_LOG_PATH = tmp; // antes do import (config lê no import)
const { registrarEvento, lerEventos } = await import('../src/write/auditoria.mjs');
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

await registrarEvento({ tipo: 'criado', draftId: 'd1', acao: 'cadastro_inquilino' });
await registrarEvento({ tipo: 'gravado', draftId: 'd1', aprovador: 'maria' });
const evs = await lerEventos({ draftId: 'd1' });
ok(evs.length === 2, 'dois eventos persistidos (append, não sobrescreve)');
ok(evs[0].tipo === 'criado' && evs[1].tipo === 'gravado', 'ordem preservada');
ok(typeof evs[0].ts === 'string' && evs[0].ts.length > 0, 'timestamp carimbado');
try { fs.unlinkSync(tmp); } catch {}
console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
