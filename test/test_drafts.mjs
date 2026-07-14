// test_drafts.mjs — ciclo de vida do draft (sem Redis = fallback Map)
import { criarDraft, getDraftByToken, getDraft, updateDraft } from '../src/write/drafts.mjs';

let falhas = 0;
const ok = (c, m) => {
  console.log(`${c ? 'OK ' : 'FALHA'} ${m}`);
  if (!c) falhas++;
};

// Test: criação de draft
const d = await criarDraft({
  acao: 'cadastro_inquilino',
  dados: { nome: 'X' },
  snapshot: [],
  solicitante: null,
  time: 'Recepção',
});
ok(d.id && d.token && d.token.length >= 16, 'gera id + token forte');
ok(d.status === 'pendente', 'nasce pendente');
ok(d.expiraEm > Date.now(), 'tem expiração futura (SLA)');

// Test: recuperar por token
const byTok = await getDraftByToken(d.token);
ok(byTok && byTok.id === d.id, 'recupera por token');

// Test: atualizar
await updateDraft(d.id, { status: 'gravado' });
ok((await getDraft(d.id)).status === 'gravado', 'updateDraft persiste patch');

// Test: token inválido
ok((await getDraftByToken('token-inexistente')) === null, 'token inválido retorna null');

// ── Modo Supabase (fake PostgREST) — prova que a migração mantém a MESMA interface pública ──
// Liga o backend Supabase mutando o objeto config diretamente em runtime (sem precisar setar
// env antes do import — config é um singleton exportado, mesmo padrão de mutação usado em
// test_e2e_write.mjs para stubar ações). fetchImpl fake nunca toca a rede/o Supabase real.
const { config } = await import('../src/config.mjs');

function makeFakeDrafts() {
  const rows = new Map(); // id -> row
  function matchParams(row, params) {
    for (const [k, v] of params) {
      if (k === 'limit' || k === 'order') continue;
      const val = v.startsWith('eq.') ? v.slice(3) : v;
      if (String(row[k]) !== val) return false;
    }
    return true;
  }
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url);
    const params = [...u.searchParams.entries()];
    const method = (opts.method || 'GET').toUpperCase();
    if (method === 'POST') {
      const row = JSON.parse(opts.body);
      rows.set(row.id, row);
      return { ok: true, status: 201, json: async () => [row], text: async () => '' };
    }
    if (method === 'GET') {
      const out = [...rows.values()].filter((r) => matchParams(r, params));
      return { ok: true, status: 200, json: async () => out, text: async () => '' };
    }
    if (method === 'PATCH') {
      const patch = JSON.parse(opts.body);
      const out = [];
      for (const r of rows.values()) if (matchParams(r, params)) { Object.assign(r, patch); out.push(r); }
      return { ok: true, status: 200, json: async () => out, text: async () => '' };
    }
    return { ok: false, status: 405, text: async () => 'method not allowed' };
  };
  return { fetchImpl };
}

config.supabaseUrl = 'https://fake.supabase.test';
config.supabaseServiceKey = 'fake-key';
const { fetchImpl } = makeFakeDrafts();

const d2 = await criarDraft({
  acao: 'cadastro_inquilino', dados: { nome: 'Y' }, snapshot: [], solicitante: null, time: 'Recepção',
}, { fetchImpl });
ok(d2.id && d2.token && d2.token.length >= 16, 'Supabase: gera id + token forte');
ok(d2.status === 'pendente', 'Supabase: nasce pendente');
ok(d2.expiraEm > Date.now(), 'Supabase: tem expiração futura (SLA)');

const byId2 = await getDraft(d2.id, { fetchImpl });
ok(byId2 && byId2.id === d2.id && byId2.token === d2.token, 'Supabase: recupera por id');

const byTok2 = await getDraftByToken(d2.token, { fetchImpl });
ok(byTok2 && byTok2.id === d2.id, 'Supabase: recupera por token');

const upd2 = await updateDraft(d2.id, { status: 'gravado' }, { fetchImpl });
ok(upd2 && upd2.status === 'gravado', 'Supabase: updateDraft persiste patch (retorno)');
ok((await getDraft(d2.id, { fetchImpl })).status === 'gravado', 'Supabase: patch refletido na releitura');

ok((await getDraftByToken('token-inexistente', { fetchImpl })) === null, 'Supabase: token inválido retorna null');
ok((await getDraft('id-inexistente', { fetchImpl })) === null, 'Supabase: id inexistente retorna null');

// restaura o fallback p/ não vazar estado a outros testes rodados no mesmo processo
config.supabaseUrl = '';
config.supabaseServiceKey = '';

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
