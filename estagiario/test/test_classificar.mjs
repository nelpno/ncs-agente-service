// test_classificar.mjs — classificador async: mapeia p/ a taxonomia, valida, nunca lança.
import assert from "node:assert";
process.env.GEMINI_API_KEY = "fake-key";
const { classificarAsync } = await import("../src/classificar.mjs");
let ok = 0;

function geminiResp(text) {
  return async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });
}
function recorder() { const calls = []; return { calls, updateFn: async (t, q, patch) => { calls.push({ t, q, patch }); } }; }

// 1) categoria válida → grava com filtro tag=is.null
{
  const { calls, updateFn } = recorder();
  await classificarAsync("i1", "o morador reclamou de barulho", { fetchImpl: geminiResp("regimento"), updateFn });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].patch.tag, "regimento");
  assert.ok(calls[0].q.includes("id=eq.i1") && calls[0].q.includes("tag=is.null"));
  ok++;
}

// 2) categoria fora da taxonomia → "outro"
{
  const { calls, updateFn } = recorder();
  await classificarAsync("i2", "qualquer coisa", { fetchImpl: geminiResp("categoria-inventada"), updateFn });
  assert.strictEqual(calls[0].patch.tag, "outro");
  ok++;
}

// 3) LLM falha (HTTP não-ok) → não grava, não lança
{
  const { calls, updateFn } = recorder();
  await classificarAsync("i3", "x", { fetchImpl: async () => ({ ok: false }), updateFn });
  assert.strictEqual(calls.length, 0);
  ok++;
}

// 4) sem GEMINI_API_KEY → no-op
{
  const saved = process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY;
  const { calls, updateFn } = recorder();
  await classificarAsync("i4", "x", { fetchImpl: geminiResp("multa"), updateFn });
  assert.strictEqual(calls.length, 0);
  process.env.GEMINI_API_KEY = saved;
  ok++;
}

// 5) fetch lança → engolido (nunca propaga)
{
  const { calls, updateFn } = recorder();
  await classificarAsync("i5", "x", { fetchImpl: async () => { throw new Error("boom"); }, updateFn });
  assert.strictEqual(calls.length, 0);
  ok++;
}

console.log(`test_classificar: ${ok}/5 OK`);
