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

// --- listarSolicitacoes: o SELECT traz origem/id/draft_id (Portal distingue e age) e NUNCA o jsonb cru ---
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
  const fields = ((q.match(/select=([^&]+)/) || [])[1] || "").split(",");
  assert.ok(fields.includes("origem"), "SELECT inclui origem (Ana x Octadesk)");
  assert.ok(fields.includes("id"), "SELECT inclui id (chave p/ o Resolver)");
  assert.ok(fields.includes("draft_id"), "SELECT inclui draft_id (distingue escrita-ERP → Aprovações)");
  assert.ok(!fields.includes("raw"), "nunca traz o jsonb cru (PII)");
  assert.ok(q.includes("order=criado_em.desc"), "mais recente primeiro");
  assert.strictEqual(itens[0].origem, "ana", "origem chega no item");
  ok++;
}

// --- resolverSolicitacao (F2, botão do Portal): fecha por ID + seta resolvido_por/em; guarda anti-"fila inteira" ---
{
  let cap = null;
  const db = { sbUpdate: async (t, s, patch) => { assert.strictEqual(t, "solicitacoes"); cap = { s, patch }; return [{ id: "u1" }]; } };
  const r = await S.resolverSolicitacao("u1", { por: "Andressa" }, db);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.atualizadas, 1, "1 linha fechada");
  assert.ok(/id=eq\.u1/.test(cap.s), "WHERE por id (só esta linha)");
  assert.ok(/draft_id=is\.null/.test(cap.s), "só fecha human-process (escrita-ERP fecha na aprovação)");
  assert.ok(/origem=eq\.ana/.test(cap.s), "nunca fecha espelhada do Octa (worker reverteria)");
  assert.strictEqual(cap.patch.status, "resolvida");
  assert.strictEqual(cap.patch.resolvido_por, "Andressa");
  assert.ok(cap.patch.resolvido_em, "seta resolvido_em");

  // 0 linhas casadas (id inexistente / era escrita-ERP / era espelhada) → ok:false (a UI reabilita o botão)
  const dbZero = { sbUpdate: async () => [] };
  const zero = await S.resolverSolicitacao("naoexiste", { por: "X" }, dbZero);
  assert.strictEqual(zero.ok, false, "0 linhas = falha, não sucesso silencioso");
  assert.strictEqual(zero.motivo, "nao_encontrada");

  // guarda CRÍTICA: sem id NÃO roda UPDATE (um WHERE vazio fecharia a fila inteira)
  let chamou = false;
  const db2 = { sbUpdate: async () => { chamou = true; return []; } };
  const bad = await S.resolverSolicitacao("", {}, db2);
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.motivo, "sem_id");
  assert.strictEqual(chamou, false, "sem id: nunca chama sbUpdate");
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

console.log(`test_solicitacoes: ${ok}/4 OK`);
