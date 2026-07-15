// test_aprovar_autenticado.mjs — o Portal consegue MESMO aprovar?
//
// Bug real (achado ao vivo 15/07, com o cliente na tela): clicar em "Aprovar" dava
// "não foi possível concluir agora". Causa: a rota /write/aprovar do agente-service exige o header
// `x-webhook-secret` quando WEBHOOK_SECRET está setado (e está, em prod) — e o chamarExecutor()
// mandava só Content-Type → 401 → o Portal mostrava erro genérico.
// Nunca ninguém tinha visto porque a FILA estava sempre vazia (os drafts iam pro Redis, não pro
// Supabase que a aba lê) — dois bugs empilhados escondendo um ao outro.
import assert from "node:assert";
import * as A from "../src/aprovacoes.mjs";

let ok = 0, total = 0;
const check = (c, m) => { total++; assert(c, m); ok++; };

// fetch falso: registra o que o Portal manda pro executor
function espiao(resposta = { ok: true, status: 200, body: { ok: true } }) {
  const visto = { url: null, headers: null, body: null };
  const f = async (url, opt) => {
    visto.url = url; visto.headers = opt.headers; visto.body = JSON.parse(opt.body);
    return { ok: resposta.ok, status: resposta.status, json: async () => resposta.body };
  };
  return { f, visto };
}

// --- com WEBHOOK_SECRET setado, o header TEM que ir junto
{
  process.env.WEBHOOK_SECRET = "segredo-fake";
  const { f, visto } = espiao();
  await A.aprovar({ draftId: "d1", aprovador: { nome: "Fernando", papel: "admin" } }, f);
  check(visto.url.endsWith("/write/aprovar"), "chama a rota do executor único");
  check(visto.headers["x-webhook-secret"] === "segredo-fake",
    `manda o x-webhook-secret (senão 401 e o botão Aprovar falha): ${JSON.stringify(visto.headers)}`);
  check(visto.body.draft_id === "d1", "manda o draft_id");
  check(visto.body.aprovador?.nome === "Fernando", "manda quem aprovou (auditoria)");
}
// --- rejeitar idem
{
  process.env.WEBHOOK_SECRET = "segredo-fake";
  const { f, visto } = espiao();
  await A.rejeitar({ draftId: "d2", aprovador: { nome: "Vitória" }, motivo: "doc faltando" }, f);
  check(visto.headers["x-webhook-secret"] === "segredo-fake", "rejeitar também manda o segredo");
  check(visto.body.motivo === "doc faltando", "rejeitar manda o motivo");
}
// --- sem segredo no ambiente, não inventa header (a rota também não exige)
{
  delete process.env.WEBHOOK_SECRET;
  const { f, visto } = espiao();
  await A.aprovar({ draftId: "d3", aprovador: { nome: "X" } }, f);
  check(!("x-webhook-secret" in visto.headers), "sem WEBHOOK_SECRET no env → não manda header vazio");
}
// --- erro do executor tem que PROPAGAR (o Portal precisa saber que falhou)
{
  process.env.WEBHOOK_SECRET = "segredo-fake";
  const { f } = espiao({ ok: false, status: 401, body: { motivo: "unauthorized" } });
  let lancou = false;
  try { await A.aprovar({ draftId: "d4", aprovador: { nome: "X" } }, f); } catch { lancou = true; }
  check(lancou, "401 do executor vira erro no Portal (não some calado)");
}

console.log(`test_aprovar_autenticado: ${ok}/${total} OK`);
