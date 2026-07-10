// test_usage_local.mjs — handleTurn acumula usage LOCAL (não global) + coleta toolsUsed.
import assert from "node:assert";
process.env.SESSION_SECRET = "x";

const { handleTurn } = await import("../src/agent.mjs");
let ok = 0;

function fakeChat(script) { let i = 0; return async () => { const r = script[Math.min(i, script.length - 1)]; i++; return r; }; }

// 1) soma usage em 2 iterações (tool call → content) + coleta toolsUsed
{
  const chat = fakeChat([
    { content: null, tool_calls: [{ id: "c1", function: { name: "__noop__", arguments: "{}" } }], usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 80 } } },
    { content: "pronto", usage: { prompt_tokens: 120, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 100 } } },
  ]);
  const r = await handleTurn({ messages: [] }, "oi", { _chat: chat });
  assert.strictEqual(r.reply, "pronto");
  assert.strictEqual(r.usage.prompt, 220, "soma prompt_tokens das 2 iterações");
  assert.strictEqual(r.usage.completion, 30);
  assert.strictEqual(r.usage.cached, 180);
  assert.strictEqual(r.toolsUsed.length, 1);
  assert.strictEqual(r.toolsUsed[0].name, "__noop__");
  ok++;
}

// 2) dois turnos CONCORRENTES não misturam contadores (usage é local ao handleTurn)
{
  const cA = fakeChat([{ content: "A", usage: { prompt_tokens: 1, completion_tokens: 1 } }]);
  const cB = fakeChat([{ content: "B", usage: { prompt_tokens: 999, completion_tokens: 999 } }]);
  const [ra, rb] = await Promise.all([
    handleTurn({ messages: [] }, "a", { _chat: cA }),
    handleTurn({ messages: [] }, "b", { _chat: cB }),
  ]);
  assert.strictEqual(ra.usage.prompt, 1, "turno A isolado");
  assert.strictEqual(rb.usage.prompt, 999, "turno B isolado");
  ok++;
}

// 3) modelo sem usage → zeros (não quebra) + modelo default presente
{
  const r = await handleTurn({ messages: [] }, "y", { _chat: fakeChat([{ content: "x" }]) });
  assert.strictEqual(r.usage.prompt, 0);
  assert.ok(r.usage.modelo, "modelo default presente");
  ok++;
}

console.log(`test_usage_local: ${ok}/3 OK`);
