// test_drafts_cas.mjs — CAS (compare-and-swap) na aprovação: 2 aprovações concorrentes do MESMO
// draft NÃO podem gravar 2x (o bug que a spec da Onda 1 conserta). Cobre os dois backends:
// fallback in-memory (mutex por id, sem Redis) e Supabase (fake PostgREST, WHERE status=eq.pendente).
import path from 'node:path';
import os from 'node:os';
process.env.AUDIT_LOG_PATH = path.join(os.tmpdir(), `cas_${Date.now()}.jsonl`); // antes dos imports que carregam config

const { config } = await import('../src/config.mjs');
const { registerAction } = await import('../src/write/registry.mjs');
const { criarRascunho, aprovarRascunho, aprovarRascunhoPorId } = await import('../src/write/engine.mjs');
const { criarDraft, getDraft, aprovarDraftCAS } = await import('../src/write/drafts.mjs');

let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 1) Fallback in-memory: 2 aprovações concorrentes via engine.aprovarRascunho(token) ──
let gravou = 0;
registerAction({
  id: 'fake_cas',
  timeAprovador: 'Recepção',
  validar: (d) => ({ ok: !!d.nome, erros: d.nome ? [] : ['faltou nome'] }),
  checarConflito: async () => ({ conflito: false, candidatos: [] }),
  snapshot: async () => ([]),
  montarPayload: (d) => ({ nome: d.nome }),
  // delay simula I/O real (chamada ao Superlógica) — alarga a janela de corrida de propósito
  gravar: async () => { await espera(15); gravou++; return { ok: true, dryRun: true }; },
  render: () => ({ campos: [], diff: [] }),
});

const cr = await criarRascunho('fake_cas', { nome: 'Concorrente' }, {});
ok(cr.ok, 'rascunho criado p/ teste de concorrência');

const [r1, r2] = await Promise.all([
  aprovarRascunho(cr.token, { aprovador: 'ana' }),
  aprovarRascunho(cr.token, { aprovador: 'bia' }),
]);
const vencedores = [r1, r2].filter((r) => r.ok && r.gravado);
const perdedores = [r1, r2].filter((r) => !r.ok && r.motivo === 'ja_em_processamento');
ok(vencedores.length === 1, 'exatamente 1 das 2 aprovações concorrentes grava');
ok(perdedores.length === 1, 'a outra recebe motivo "ja_em_processamento" (não "erro", não silêncio)');
ok(gravou === 1, 'acao.gravar() foi chamada só 1x — sem gravação dupla no Superlógica');

// CAS num draft já gravado: não reabre (idempotência preservada mesmo após a corrida)
const casDepois = await aprovarDraftCAS(vencedores[0].draft.id, 'carlos');
ok(casDepois === null, 'CAS falha (null) num draft já gravado — status não é mais "pendente"');

// ── 2) aprovarRascunhoPorId — mesmo fluxo, resolvendo por draft_id (o executor HTTP do Portal
//    recebe draft_id, não token) ──
let gravou2 = 0;
registerAction({
  id: 'fake_cas_id',
  timeAprovador: 'Recepção',
  validar: () => ({ ok: true, erros: [] }),
  montarPayload: (d) => d,
  gravar: async () => { await espera(10); gravou2++; return { ok: true, dryRun: true }; },
  render: () => ({ campos: [], diff: [] }),
});
const cr2 = await criarRascunho('fake_cas_id', { nome: 'PorId' }, {});
const [p1, p2] = await Promise.all([
  aprovarRascunhoPorId(cr2.draftId, { aprovador: 'ana' }),
  aprovarRascunhoPorId(cr2.draftId, { aprovador: 'bia' }),
]);
ok([p1, p2].filter((r) => r.ok && r.gravado).length === 1, 'aprovarRascunhoPorId: só 1 das 2 grava');
ok([p1, p2].filter((r) => !r.ok && r.motivo === 'ja_em_processamento').length === 1, 'aprovarRascunhoPorId: a outra fica ja_em_processamento');
ok(gravou2 === 1, 'aprovarRascunhoPorId: gravar() chamada só 1x');

// ── 3) Modo Supabase (fake PostgREST): a MESMA garantia no backend de produção ──
// UPDATE escrita_drafts SET status='aprovando' WHERE id=X AND status='pendente' RETURNING *
// — só 1 das 2 PATCH concorrentes acha a linha (a 2ª já não casa mais o WHERE, volta []).
function makeFakeDrafts() {
  const rows = new Map();
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

const d3 = await criarDraft({ acao: 'fake_cas', dados: { nome: 'Sb' }, snapshot: [], solicitante: null, time: 'Recepção' }, { fetchImpl });
ok(d3.status === 'pendente', 'Supabase: draft nasce pendente');

const [c1, c2] = await Promise.all([
  aprovarDraftCAS(d3.id, 'ana', { fetchImpl }),
  aprovarDraftCAS(d3.id, 'bia', { fetchImpl }),
]);
const ganhou = [c1, c2].filter(Boolean);
ok(ganhou.length === 1, 'Supabase: WHERE status=eq.pendente garante só 1 UPDATE efetivo');
ok(ganhou[0].status === 'aprovando', 'Supabase: vencedor fica com status "aprovando"');
ok(ganhou[0].aprovadoPor?.nome === (ganhou[0] === c1 ? 'ana' : 'bia'), 'Supabase: aprovado_por gravado (string legado normalizada p/ {nome})');

const posCas = await getDraft(d3.id, { fetchImpl });
ok(posCas.status === 'aprovando', 'Supabase: releitura confirma o estado pós-CAS');

// restaura o fallback p/ não vazar estado a outros testes rodados no mesmo processo
config.supabaseUrl = '';
config.supabaseServiceKey = '';

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
