// test_pendencias.mjs — aba Pendências / outbox (spec Onda 1 §4.3): gating puro + query só-leitura.
import assert from "node:assert";
process.env.SESSION_SECRET = "x";

const P = await import("../src/pendencias.mjs");
let ok = 0;

// --- gating: pode_aprovar OU owner/admin (diferente de Aprovações — aqui gestão também entra) ---
{
  assert.strictEqual(P.podeVerPendencias({ podeAprovar: true, papel: "funcionario" }), true, "funcionário com o flag vê");
  assert.strictEqual(P.podeVerPendencias({ podeAprovar: false, papel: "owner" }), true, "owner vê mesmo sem o flag");
  assert.strictEqual(P.podeVerPendencias({ podeAprovar: false, papel: "admin" }), true, "admin vê mesmo sem o flag");
  assert.strictEqual(P.podeVerPendencias({ podeAprovar: false, papel: "funcionario" }), false, "funcionário sem o flag NÃO vê");
  assert.strictEqual(P.podeVerPendencias(null), false, "sem sessão → false, não lança");
  assert.strictEqual(P.podeVerPendencias({}), false);
  ok++;
}

// --- listarPendentes: filtra status pendente_humano/falhou (nunca 'enviado'), mais recente primeiro ---
{
  const db = {
    sbSelect: async (t, q) => {
      assert.strictEqual(t, "notificacoes");
      assert.ok(q.includes("status=in.(pendente_humano,falhou)"), "só o que precisa de atenção humana");
      assert.ok(q.includes("order=criado_em.desc"), "mais recente primeiro");
      return [{ id: "n1", evento: "cadastro_inquilino", status: "falhou", ultimo_erro: "SMTP timeout" }];
    },
  };
  const itens = await P.listarPendentes(db);
  assert.strictEqual(itens.length, 1);
  assert.strictEqual(itens[0].status, "falhou");
  ok++;
}

console.log(`test_pendencias: ${ok}/2 OK`);
