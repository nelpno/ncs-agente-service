// test_e2e_write.mjs — caminho feliz ponta a ponta em DRY_RUN
process.env.DRY_RUN_WRITES = 'true';
import path from 'node:path'; import os from 'node:os'; import fs from 'node:fs';
process.env.AUDIT_LOG_PATH = path.join(os.tmpdir(), `e2e_${Date.now()}.jsonl`);
const { runToolReal } = await import('../src/agent.mjs');
const { aprovarRascunho } = await import('../src/write/engine.mjs');
const { lerEventos } = await import('../src/write/auditoria.mjs');
// e2e sem rede: sobrescreve as funções de IO da ação (snapshot/checarConflito) por stubs.
// Mutar propriedades do objeto exportado é OK (mexe na propriedade, não na binding ESM). Feito ANTES do runToolReal.
const mod = await import('../src/write/actions/cadastro_inquilino.mjs');
mod.cadastroInquilino.snapshot = async () => ([]);
mod.cadastroInquilino.checarConflito = async () => ({ conflito: false, candidatos: [] });

let falhas = 0; const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };
const ctx = { chatId: null };
const r = await runToolReal('criar_rascunho_cadastro', { id_condominio: '181', id_unidade: '900', nome: 'Maria Teste', data_entrada: '10/06/2026' }, ctx);
ok(r.criado === true, 'tool criou rascunho');
const token = ctx.draft[0].token;
const ap = await aprovarRascunho(token, { aprovador: 'Recepcao' });
ok(ap.ok && ap.gravado && ap.dryRun === true, 'aprovado e gravado em DRY_RUN');
const evs = await lerEventos({ draftId: r.protocolo });
ok(evs.some((e) => e.tipo === 'criado') && evs.some((e) => e.tipo === 'gravado'), 'auditoria completa');
try { fs.unlinkSync(process.env.AUDIT_LOG_PATH); } catch {}
console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
