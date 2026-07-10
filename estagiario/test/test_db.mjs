// test_db.mjs — cliente Supabase (PostgREST) monta URL/headers/método certos, sem rede real.
import assert from "node:assert";

process.env.SUPABASE_URL = "https://proj.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "svc-key-123";

const { sbSelect, sbInsert, sbUpdate } = await import("../src/db.mjs");

let ok = 0;
function calls() {
  const rec = [];
  const fake = async (url, opts) => {
    rec.push({ url, opts });
    return { ok: true, status: 200, json: async () => [{ id: "x1" }], text: async () => "" };
  };
  return { rec, fake };
}

// sbSelect
{
  const { rec, fake } = calls();
  await sbSelect("usuarios", "email=eq.a@b.c&select=*", fake);
  assert.strictEqual(rec[0].url, "https://proj.supabase.co/rest/v1/usuarios?email=eq.a@b.c&select=*");
  assert.strictEqual(rec[0].opts.headers.apikey, "svc-key-123");
  assert.strictEqual(rec[0].opts.headers.Authorization, "Bearer svc-key-123");
  ok++;
}
// sbInsert → retorna 1º item + Prefer representation
{
  const { rec, fake } = calls();
  const row = await sbInsert("interacoes", { tag: "multa" }, fake);
  assert.strictEqual(rec[0].opts.method, "POST");
  assert.strictEqual(rec[0].opts.headers.Prefer, "return=representation");
  assert.strictEqual(JSON.parse(rec[0].opts.body).tag, "multa");
  assert.strictEqual(row.id, "x1");
  ok++;
}
// sbUpdate → PATCH com filtro na URL
{
  const { rec, fake } = calls();
  await sbUpdate("usuarios", "id=eq.u1", { ativo: false }, fake);
  assert.strictEqual(rec[0].opts.method, "PATCH");
  assert.strictEqual(rec[0].url, "https://proj.supabase.co/rest/v1/usuarios?id=eq.u1");
  assert.strictEqual(JSON.parse(rec[0].opts.body).ativo, false);
  ok++;
}
// erro HTTP → lança
{
  const fake = async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => "no" });
  await assert.rejects(() => sbSelect("usuarios", "", fake));
  ok++;
}

console.log(`test_db: ${ok}/4 OK`);
