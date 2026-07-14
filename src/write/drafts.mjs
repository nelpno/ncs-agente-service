// drafts.mjs — rascunhos de escrita pendentes de aprovação.
// Persistência: Supabase (escrita_drafts) quando sbEnabled()===true; senão fallback KV (Redis+in-memory,
// via memory.mjs) — mantém o DRY_RUN local e os testes rodando sem tocar o banco real.
// Interface pública (criarDraft/getDraft/getDraftByToken/updateDraft) é a MESMA nos dois backends.
import crypto from 'node:crypto';
import { kvGet, kvSet } from '../memory.mjs';
import { config } from '../config.mjs';
import { sbEnabled, sbSelect, sbInsert, sbUpdate } from '../db_ncs.mjs';

const PREFIX_ID = 'draft:id:';
const PREFIX_TOK = 'draft:tok:'; // token -> id (índice, só usado no fallback)
const TABLE = 'escrita_drafts';

const ttlS = () => config.approvalTtlH * 3600;

// ── mapeamento JS (camelCase) <-> coluna Supabase (snake_case) ──────────────
// solicitante/ator são `text` no schema mas carregam objeto JS às vezes → serializa/desserializa.
function toText(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}
function fromText(v) {
  if (typeof v !== 'string') return v ?? null;
  try { return JSON.parse(v); } catch { return v; }
}
function normalizeAprovador(a) {
  if (a === null || a === undefined) return null;
  if (typeof a === 'string') return { nome: a };
  return a;
}

const FIELD_MAP = {
  acao: 'acao',
  dados: 'dados',
  snapshot: 'snapshot',
  conflito: 'conflito',
  origem: 'origem',
  time: 'time_aprovador',
  status: 'status',
  resultado: 'resultado',
  aprovadoPor: 'aprovado_por',
};

function draftPatchToRow(patch) {
  const row = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'id' || k === 'token') continue; // não patcháveis
    if (k === 'solicitante') { row.solicitante = toText(v); continue; }
    if (k === 'criadoEm') { row.criado_em = new Date(v).toISOString(); continue; }
    if (k === 'expiraEm') { row.expira_em = v ? new Date(v).toISOString() : null; continue; }
    if (k in FIELD_MAP) { row[FIELD_MAP[k]] = v; continue; }
  }
  return row;
}

function draftToRow(d) {
  return {
    id: d.id,
    token: d.token,
    ...draftPatchToRow({ ...d, criadoEm: d.criadoEm ?? Date.now() }),
  };
}

function rowToDraft(r) {
  if (!r) return null;
  return {
    id: r.id,
    token: r.token,
    acao: r.acao,
    dados: r.dados ?? null,
    snapshot: r.snapshot ?? null,
    conflito: r.conflito ?? null,
    origem: r.origem ?? null,
    solicitante: fromText(r.solicitante),
    time: r.time_aprovador ?? null,
    status: r.status,
    aprovadoPor: r.aprovado_por ?? null,
    resultado: r.resultado ?? null,
    criadoEm: r.criado_em ? Date.parse(r.criado_em) : null,
    expiraEm: r.expira_em ? Date.parse(r.expira_em) : null,
  };
}

/**
 * Cria um novo draft (rascunho de escrita).
 * @param {object} opts - { acao, dados, snapshot, solicitante, time, conflito?, origem? }
 * @param {object} deps - { fetchImpl? } (injeção p/ teste; produção usa fetch real)
 * @returns {Promise<object>} Draft com id, token, status='pendente', expiraEm, timestamps
 */
export async function criarDraft({
  acao,
  dados,
  snapshot,
  solicitante,
  time,
  conflito = null,
  origem = null,
}, deps = {}) {
  const id = crypto.randomBytes(8).toString('hex');
  const token = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  const draft = {
    id,
    token,
    acao,
    dados,
    snapshot,
    solicitante,
    time,
    conflito,
    origem,
    status: 'pendente',
    aprovadoPor: null,
    resultado: null,
    criadoEm: now,
    expiraEm: now + ttlS() * 1000,
  };

  if (sbEnabled()) {
    const row = await sbInsert(TABLE, draftToRow(draft), deps.fetchImpl);
    return rowToDraft(row) || draft;
  }

  await kvSet(PREFIX_ID + id, draft, ttlS());
  await kvSet(PREFIX_TOK + token, id, ttlS());
  return draft;
}

/**
 * Recupera draft por ID.
 * @param {string} id
 * @param {object} deps - { fetchImpl? }
 * @returns {Promise<object|null>}
 */
export async function getDraft(id, deps = {}) {
  if (sbEnabled()) {
    const rows = await sbSelect(TABLE, `id=eq.${encodeURIComponent(id)}&limit=1`, deps.fetchImpl);
    return rows[0] ? rowToDraft(rows[0]) : null;
  }
  return kvGet(PREFIX_ID + id);
}

/**
 * Recupera draft por token.
 * @param {string} token
 * @param {object} deps - { fetchImpl? }
 * @returns {Promise<object|null>}
 */
export async function getDraftByToken(token, deps = {}) {
  if (sbEnabled()) {
    const rows = await sbSelect(TABLE, `token=eq.${encodeURIComponent(token)}&limit=1`, deps.fetchImpl);
    return rows[0] ? rowToDraft(rows[0]) : null;
  }
  const id = await kvGet(PREFIX_TOK + token);
  if (!id) return null;
  return getDraft(id, deps);
}

/**
 * Atualiza draft com patch (merge parcial). NUNCA deleta a linha (expiração marca status, não apaga).
 * No fallback in-memory, também estende o TTL para refletir a expiração restante.
 * @param {string} id
 * @param {object} patch - campos a atualizar
 * @param {object} deps - { fetchImpl? }
 * @returns {Promise<object|null>} Draft atualizado ou null se não existe
 */
export async function updateDraft(id, patch, deps = {}) {
  if (sbEnabled()) {
    const rows = await sbUpdate(TABLE, `id=eq.${encodeURIComponent(id)}`, draftPatchToRow(patch), deps.fetchImpl);
    return rows[0] ? rowToDraft(rows[0]) : null;
  }
  const cur = await kvGet(PREFIX_ID + id);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  const restanteS = Math.max(60, Math.ceil((next.expiraEm - Date.now()) / 1000));
  await kvSet(PREFIX_ID + id, next, restanteS);
  await kvSet(PREFIX_TOK + next.token, id, restanteS);
  return next;
}

// ── CAS (compare-and-swap) na aprovação — conserta a gravação dupla ─────────
// Supabase: UPDATE ... WHERE id=X AND status='pendente' RETURNING * — atômico no banco.
// Fallback in-memory: sem transação real, então serializa por id via fila de promises (mutex),
// já que "ler status, depois escrever" tem um ponto de `await` entre as duas operações onde
// duas chamadas concorrentes podem intercalar (não dá pra confiar em "Map é síncrono").
const locks = new Map(); // id -> Promise (fila de acesso exclusivo)
function withLock(id, fn) {
  const prev = locks.get(id) || Promise.resolve();
  const chain = prev.catch(() => {}).then(fn);
  const guarded = chain.catch(() => {});
  locks.set(id, guarded);
  guarded.finally(() => { if (locks.get(id) === guarded) locks.delete(id); });
  return chain;
}

/**
 * Tenta reivindicar o draft (pendente -> aprovando) de forma atômica.
 * @param {string} id
 * @param {object|string} aprovadoPor - {user_id,nome,papel} ou string legado (vira {nome})
 * @param {object} deps - { fetchImpl? }
 * @returns {Promise<object|null>} draft (já em 'aprovando') se este processo venceu; null se outro já pegou.
 */
export async function aprovarDraftCAS(id, aprovadoPor, deps = {}) {
  const aprovadoPorNorm = normalizeAprovador(aprovadoPor);

  if (sbEnabled()) {
    const rows = await sbUpdate(
      TABLE,
      `id=eq.${encodeURIComponent(id)}&status=eq.pendente`,
      { status: 'aprovando', aprovado_por: aprovadoPorNorm },
      deps.fetchImpl,
    );
    return rows[0] ? rowToDraft(rows[0]) : null;
  }

  return withLock(id, async () => {
    const cur = await kvGet(PREFIX_ID + id);
    if (!cur || cur.status !== 'pendente') return null;
    const next = { ...cur, status: 'aprovando', aprovadoPor: aprovadoPorNorm };
    const restanteS = Math.max(60, Math.ceil((cur.expiraEm - Date.now()) / 1000));
    await kvSet(PREFIX_ID + id, next, restanteS);
    await kvSet(PREFIX_TOK + next.token, id, restanteS);
    return next;
  });
}
