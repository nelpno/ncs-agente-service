// test_prompt_ancora_estag.mjs — deploy de prompt tem que pegar em sessão VIVA (Estagiário).
//
// Mesmo buraco que mordeu a Ana em 15/07, aqui ainda aberto: o system prompt só era inserido quando
// `session.messages` estava VAZIO. Como a sessão do Estagiário é Redis 48h (ligado em 14/07, 76164f5)
// e a equipe deixa a aba aberta o dia todo, a sessão CONGELA a versão velha do prompt: no deploy do
// C23 (16/07) havia 13 sessões vivas, uma com 46h — a Luciana abriria a dela no dia seguinte e
// receberia o prompt SEM a regra nova, com o deploy parecendo feito.
//
// Uso: node estagiario/test/test_prompt_ancora_estag.mjs
import assert from "node:assert";
process.env.SESSION_SECRET = "x";

const { _ancorarSystemPrompt, handleTurn } = await import("../src/agent.mjs");
let ok = 0;
const t = (nome, fn) => { fn(); ok++; console.log("  ok  " + nome); };

t("sessão nova → insere o system prompt na posição 0", () => {
  const s = { messages: [] };
  assert.strictEqual(_ancorarSystemPrompt(s, "PROMPT A"), "inserido");
  assert.strictEqual(s.messages[0].role, "system");
  assert.strictEqual(s.messages[0].content, "PROMPT A");
});

t("O BUG: sessão viva com prompt velho → ATUALIZA (o deploy pega)", () => {
  const s = { messages: [{ role: "system", content: "PROMPT VELHO" }, { role: "user", content: "horario de mudanca" }] };
  assert.strictEqual(_ancorarSystemPrompt(s, "PROMPT NOVO"), "atualizado");
  assert.strictEqual(s.messages[0].content, "PROMPT NOVO");
  assert.strictEqual(s.messages[1].content, "horario de mudanca", "histórico preservado");
  assert.strictEqual(s.messages.length, 2, "não duplica o system");
});

t("prompt igual → não mexe (preserva o cache de prefixo da OpenAI)", () => {
  const s = { messages: [{ role: "system", content: "PROMPT A" }, { role: "user", content: "oi" }] };
  assert.strictEqual(_ancorarSystemPrompt(s, "PROMPT A"), "ok");
});

t("msg[0] não-system (sessão legada) → não sobrescreve a fala da equipe", () => {
  const s = { messages: [{ role: "user", content: "oi" }] };
  assert.strictEqual(_ancorarSystemPrompt(s, "PROMPT A"), "ok");
  assert.strictEqual(s.messages[0].role, "user");
});

// Prova pelo caminho REAL (handleTurn), não só pela função solta: é o handleTurn que a sessão viva atravessa.
await (async () => {
  const s = { messages: [{ role: "system", content: "PROMPT ANTIGO DE ONTEM" }, { role: "user", content: "oi" }] };
  const chat = async () => ({ content: "pronto", usage: { prompt_tokens: 1, completion_tokens: 1 } });
  await handleTurn(s, "e o horario de mudanca?", { _chat: chat });
  assert.notStrictEqual(s.messages[0].content, "PROMPT ANTIGO DE ONTEM", "handleTurn tem que reancorar o prompt");
  assert.ok(/condomínio de CADA pergunta/i.test(s.messages[0].content), "a sessão viva recebeu o prompt ATUAL (com o C23)");
  ok++; console.log("  ok  handleTurn reancora o prompt numa sessão viva (caminho real)");
})();

console.log(`\n${ok}/${ok} test_prompt_ancora_estag OK`);
