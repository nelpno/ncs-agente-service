// test_registro.mjs — monta e grava a linha de `interacoes` (determinístico + db injetável).
import assert from "node:assert";
const { montarInteracao, gravarInteracao } = await import("../src/registro.mjs");
let ok = 0;

// 1) turno de multa: linha completa e correta
{
  const sess = { uid: "u1", papel: "funcionario", nome: "Malu" };
  const turno = {
    reply: "Gerei a multa. Confira e o síndico assina. ".repeat(40), // > 500 chars
    doc: { url: "/doc/x.doc", titulo: "Multa" },
    usage: { prompt: 8000, completion: 90, cached: 7000, modelo: "gpt-5.4" },
    toolsUsed: [{ name: "listar_infracoes", args: { condominio: "lume" } }, { name: "gerar_documento", args: { tipo: "multa", condominio: "lume" } }],
  };
  const row = montarInteracao({ sess, sessionId: "estag-u1-abc", userText: "morador do 132 fez barulho de novo", turno, tMs: 1234, erro: false });
  assert.strictEqual(row.usuario_id, "u1");
  assert.strictEqual(row.session_id, "estag-u1-abc");
  assert.strictEqual(row.condominio, "lume");
  assert.strictEqual(row.tag, "multa", "tag = multa (não cadastro)");
  assert.strictEqual(row.tipo_doc, "multa");
  assert.strictEqual(row.gerou_doc, true);
  assert.strictEqual(row.tokens_prompt, 8000);
  assert.strictEqual(row.tokens_completion, 90);
  assert.strictEqual(row.tokens_cached, 7000);
  assert.strictEqual(row.modelo, "gpt-5.4");
  assert.strictEqual(row.latencia_ms, 1234);
  assert.strictEqual(row.erro, false);
  assert.ok(row.resposta.length <= 500, "resposta truncada em ~500");
  assert.strictEqual(row.pergunta, "morador do 132 fez barulho de novo");
  ok++;
}

// 2) turno com ERRO → erro=true, tag null, sem doc, zeros
{
  const row = montarInteracao({ sess: { uid: "u2" }, sessionId: "estag-u2-z", userText: "oi", turno: { reply: "", usage: {}, toolsUsed: [] }, tMs: 50, erro: true });
  assert.strictEqual(row.erro, true);
  assert.strictEqual(row.tag, null);
  assert.strictEqual(row.gerou_doc, false);
  assert.strictEqual(row.tokens_prompt, 0);
  ok++;
}

// 3) gravarInteracao usa sbInsert('interacoes',...) e devolve o id
{
  const calls = [];
  const db = { sbInsert: async (t, row) => { calls.push([t, row]); return { id: "i1" }; } };
  const id = await gravarInteracao({ tag: "cnd" }, db);
  assert.strictEqual(id, "i1");
  assert.strictEqual(calls[0][0], "interacoes");
  ok++;
}

console.log(`test_registro: ${ok}/3 OK`);
