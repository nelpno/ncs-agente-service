// test_solicitacoes.mjs — aba Solicitações (espelho do Octadesk + linhas próprias da Ana):
// gate de acesso + query só-leitura que TRAZ `origem` (p/ o Portal distinguir Ana × Octadesk) e nunca PII.
import assert from "node:assert";
process.env.SESSION_SECRET = "x";

const S = await import("../src/solicitacoes.mjs");
let ok = 0;

// --- gate: owner/admin/funcionário veem (fila operacional, sem PII); outros não ---
{
  assert.strictEqual(S.podeVerSolicitacoes({ papel: "owner" }), true);
  assert.strictEqual(S.podeVerSolicitacoes({ papel: "admin" }), true);
  assert.strictEqual(S.podeVerSolicitacoes({ papel: "funcionario" }), true, "funcionário vê (triagem do dia a dia)");
  assert.strictEqual(S.podeVerSolicitacoes({ papel: "sindico" }), false, "papel de fora NÃO vê");
  assert.strictEqual(S.podeVerSolicitacoes(null), false, "sem sessão → false, não lança");
  assert.strictEqual(S.podeVerSolicitacoes({}), false);
  ok++;
}

// --- listarSolicitacoes: o SELECT traz `origem` (Ana × Octadesk) e NUNCA o jsonb cru (raw) ---
{
  let q = null;
  const db = {
    sbSelect: async (t, s) => {
      assert.strictEqual(t, "solicitacoes");
      q = s;
      return [{ protocolo_ncs: "NCS-A-2", origem: "ana", tipo: "mudanca", status: "aberta" }];
    },
  };
  const itens = await S.listarSolicitacoes({}, db);
  assert.ok(q.includes("origem"), "SELECT inclui origem (Portal distingue Ana x Octadesk)");
  assert.ok(q.includes("order=criado_em.desc"), "mais recente primeiro");
  assert.ok(!q.includes("raw"), "nunca traz o jsonb cru (PII)");
  assert.strictEqual(itens[0].origem, "ana", "origem chega no item");
  ok++;
}

// --- filtros tipo/status passam (encode) ---
{
  let q = null;
  const db = { sbSelect: async (_t, s) => { q = s; return []; } };
  await S.listarSolicitacoes({ tipo: "mudanca", status: "aberta" }, db);
  assert.ok(q.includes("tipo=eq.mudanca") && q.includes("status=eq.aberta"), "aplica filtros tipo/status");
  ok++;
}

console.log(`test_solicitacoes: ${ok}/3 OK`);
