// db_ncs.mjs — cliente Supabase (PostgREST + service_role) do agente-service.
// MESMO Supabase dedicado do NCS (dcirzddyoctxugfowvob) que o Estagiário usa; tabelas são deny-all.
// service_role bypassa RLS. Sem SDK: fetch nativo. fetchImpl injetável p/ teste. NUNCA logar a service key.
// Base da Onda 1 (motor de escritas/outbox/contatos). Espelha o padrão de estagiario/src/db.mjs.
import { config } from './config.mjs';

const BASE = () => `${config.supabaseUrl}/rest/v1`;
const H = () => ({
  apikey: config.supabaseServiceKey,
  Authorization: `Bearer ${config.supabaseServiceKey}`,
  'Content-Type': 'application/json',
});
const TIMEOUT = () => AbortSignal.timeout(config.sbTimeoutMs);

// true quando há credencial de Supabase. Módulos caem no fallback (Redis/in-memory) quando false,
// para o DRY_RUN local e os testes rodarem sem tocar o banco real.
export function sbEnabled() {
  return !!(config.supabaseUrl && config.supabaseServiceKey);
}

export async function sbSelect(table, query = '', fetchImpl = fetch) {
  const r = await fetchImpl(`${BASE()}/${table}?${query}`, { headers: H(), signal: TIMEOUT() });
  if (!r.ok) throw new Error(`sbSelect ${table} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

export async function sbInsert(table, row, fetchImpl = fetch) {
  const r = await fetchImpl(`${BASE()}/${table}`, {
    method: 'POST',
    headers: { ...H(), Prefer: 'return=representation' },
    body: JSON.stringify(row),
    signal: TIMEOUT(),
  });
  if (!r.ok) throw new Error(`sbInsert ${table} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json())[0];
}

// PATCH com WHERE via querystring + return=representation.
// É a base do compare-and-swap: sbUpdate('escrita_drafts', 'id=eq.X&status=eq.pendente', {...})
// retorna [] se ninguém casou o WHERE (outro aprovador já venceu) ou [row] se este processo venceu.
export async function sbUpdate(table, query, patch, fetchImpl = fetch) {
  const r = await fetchImpl(`${BASE()}/${table}?${query}`, {
    method: 'PATCH',
    headers: { ...H(), Prefer: 'return=representation' },
    body: JSON.stringify(patch),
    signal: TIMEOUT(),
  });
  if (!r.ok) throw new Error(`sbUpdate ${table} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
