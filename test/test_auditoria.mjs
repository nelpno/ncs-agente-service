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

// ── Modo Supabase (fake PostgREST escrita_eventos) — mesma interface, backend durável ──
const { config } = await import('../src/config.mjs');

function makeFakeEventos() {
  const rows = [];
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url);
    const method = (opts.method || 'GET').toUpperCase();
    if (method === 'POST') {
      const row = { id: String(rows.length + 1), criado_em: new Date(Date.now() + rows.length).toISOString(), ...JSON.parse(opts.body) };
      rows.push(row);
      return { ok: true, status: 201, json: async () => [row], text: async () => '' };
    }
    if (method === 'GET') {
      const p = u.searchParams.get('draft_id');
      const draftId = p?.startsWith('eq.') ? p.slice(3) : null;
      const out = rows.filter((r) => !draftId || r.draft_id === draftId);
      return { ok: true, status: 200, json: async () => out, text: async () => '' };
    }
    return { ok: false, status: 405, text: async () => 'method not allowed' };
  };
  return { fetchImpl };
}

config.supabaseUrl = 'https://fake.supabase.test';
config.supabaseServiceKey = 'fake-key';
const { fetchImpl } = makeFakeEventos();

await registrarEvento({ tipo: 'criado', draftId: 'd2', acao: 'cadastro_inquilino' }, { fetchImpl });
await registrarEvento({ tipo: 'gravado', draftId: 'd2', aprovador: 'maria' }, { fetchImpl });
const evs2 = await lerEventos({ draftId: 'd2' }, { fetchImpl });
ok(evs2.length === 2, 'Supabase: dois eventos persistidos (append-only)');
ok(evs2[0].tipo === 'criado' && evs2[1].tipo === 'gravado', 'Supabase: ordem preservada');
ok(evs2[0].acao === 'cadastro_inquilino', 'Supabase: payload extra mapeado de volta (acao)');
ok(evs2[1].aprovador === 'maria', 'Supabase: ator (aprovador) mapeado de volta');
ok(typeof evs2[0].ts === 'string' && evs2[0].ts.length > 0, 'Supabase: timestamp carimbado (criado_em)');
ok((await lerEventos({ draftId: 'inexistente' }, { fetchImpl })).length === 0, 'Supabase: draft sem eventos retorna vazio');

config.supabaseUrl = '';
config.supabaseServiceKey = '';

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
