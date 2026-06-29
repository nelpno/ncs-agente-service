// drafts.mjs — rascunhos de escrita pendentes de aprovação. Persistência via KV (Redis+fallback).
import crypto from 'node:crypto';
import { kvGet, kvSet } from '../memory.mjs';
import { config } from '../config.mjs';

const PREFIX_ID = 'draft:id:';
const PREFIX_TOK = 'draft:tok:'; // token -> id (índice)

const ttlS = () => config.approvalTtlH * 3600;

/**
 * Cria um novo draft (rascunho de escrita).
 * @param {object} opts - { acao, dados, snapshot, solicitante, time, conflito?, origem? }
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
}) {
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
    criadoEm: now,
    expiraEm: now + ttlS() * 1000,
  };
  await kvSet(PREFIX_ID + id, draft, ttlS());
  await kvSet(PREFIX_TOK + token, id, ttlS());
  return draft;
}

/**
 * Recupera draft por ID.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getDraft(id) {
  return kvGet(PREFIX_ID + id);
}

/**
 * Recupera draft por token (índice).
 * @param {string} token
 * @returns {Promise<object|null>}
 */
export async function getDraftByToken(token) {
  const id = await kvGet(PREFIX_TOK + token);
  if (!id) return null;
  return getDraft(id);
}

/**
 * Atualiza draft com patch (merge parcial).
 * Estende o TTL para refletir a expiração restante.
 * @param {string} id
 * @param {object} patch - campos a atualizar
 * @returns {Promise<object|null>} Draft atualizado ou null se não existe
 */
export async function updateDraft(id, patch) {
  const cur = await getDraft(id);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  const restanteS = Math.max(60, Math.ceil((next.expiraEm - Date.now()) / 1000));
  await kvSet(PREFIX_ID + id, next, restanteS);
  await kvSet(PREFIX_TOK + next.token, id, restanteS);
  return next;
}
