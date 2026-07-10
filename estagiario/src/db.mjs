// db.mjs — cliente Supabase via PostgREST + service_role (server-side).
// Sem SDK: fetch nativo. service_role bypassa RLS (tabelas são deny-all).
// fetchImpl injetável para teste. NUNCA logar a service key.

const BASE = () => `${process.env.SUPABASE_URL}/rest/v1`;
const H = () => ({
  apikey: process.env.SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
  "Content-Type": "application/json",
});
const TIMEOUT = () => AbortSignal.timeout(Number(process.env.SB_TIMEOUT_MS || 15000));

export async function sbSelect(table, query = "", fetchImpl = fetch) {
  const r = await fetchImpl(`${BASE()}/${table}?${query}`, { headers: H(), signal: TIMEOUT() });
  if (!r.ok) throw new Error(`sbSelect ${table} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

export async function sbInsert(table, row, fetchImpl = fetch) {
  const r = await fetchImpl(`${BASE()}/${table}`, {
    method: "POST",
    headers: { ...H(), Prefer: "return=representation" },
    body: JSON.stringify(row),
    signal: TIMEOUT(),
  });
  if (!r.ok) throw new Error(`sbInsert ${table} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json())[0];
}

export async function sbUpdate(table, query, patch, fetchImpl = fetch) {
  const r = await fetchImpl(`${BASE()}/${table}?${query}`, {
    method: "PATCH",
    headers: { ...H(), Prefer: "return=representation" },
    body: JSON.stringify(patch),
    signal: TIMEOUT(),
  });
  if (!r.ok) throw new Error(`sbUpdate ${table} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
