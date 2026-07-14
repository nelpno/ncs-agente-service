// auditoria.mjs — log append-only durável de escritas (NÃO é log de aplicação; contém PII).
// Persistência: Supabase (escrita_eventos) quando sbEnabled()===true; senão fallback JSONL local
// (mantém a auditoria disponível offline/DRY_RUN, mesmo padrão de drafts.mjs).
// Append-only nos dois backends: nunca update/delete.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.mjs';
import { sbEnabled, sbSelect, sbInsert } from '../db_ncs.mjs';

const TABLE = 'escrita_eventos';

function ensureDir() {
  const dir = path.dirname(config.auditLogPath);
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
}

function toText(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}
function fromText(v) {
  if (typeof v !== 'string') return v ?? null;
  try { return JSON.parse(v); } catch { return v; }
}

function rowToEvento(r) {
  return {
    ts: r.criado_em,
    draftId: r.draft_id,
    tipo: r.tipo,
    aprovador: fromText(r.ator),
    ...(r.payload || {}),
  };
}

/**
 * Registra um evento de auditoria (append-only).
 * @param {object} ev - { tipo, draftId?, aprovador?, solicitante?, ...resto }
 * @param {object} deps - { fetchImpl? }
 */
export async function registrarEvento(ev, deps = {}) {
  if (sbEnabled()) {
    const { draftId, tipo, aprovador, solicitante, ...resto } = ev;
    const row = {
      draft_id: draftId || null,
      tipo,
      ator: toText(aprovador || solicitante || null),
      payload: resto,
    };
    await sbInsert(TABLE, row, deps.fetchImpl);
    return;
  }
  ensureDir();
  const linha = JSON.stringify({ ts: new Date().toISOString(), ...ev }) + '\n';
  await fs.promises.appendFile(config.auditLogPath, linha, 'utf8');
}

/**
 * Lê eventos, filtrando por igualdade exata de campos (ex.: { draftId: 'x' }).
 * @param {object} filtro
 * @param {object} deps - { fetchImpl? }
 */
export async function lerEventos(filtro = {}, deps = {}) {
  if (sbEnabled()) {
    const params = ['order=criado_em.asc'];
    if (filtro.draftId) params.push(`draft_id=eq.${encodeURIComponent(filtro.draftId)}`);
    const rows = await sbSelect(TABLE, params.join('&'), deps.fetchImpl);
    const evs = rows.map(rowToEvento);
    return evs.filter((e) => Object.entries(filtro).every(([k, v]) => e[k] === v));
  }
  let raw;
  try { raw = await fs.promises.readFile(config.auditLogPath, 'utf8'); }
  catch { return []; }
  const evs = raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return evs.filter((e) => Object.entries(filtro).every(([k, v]) => e[k] === v));
}
