// test_metrics.mjs — custo R$ na leitura + agregações do painel. Custo é do OWNER (não do admin cliente).
import assert from "node:assert";
const M = await import("../src/metrics.mjs");
let ok = 0;
const env = { USD_BRL: "5.00", MODEL_PRICE_GPT_5_4: "2.50/0.25/15" };

// 1) custoBRL: prompt INCLUI cached → cobra o cached barato + o resto cheio + a saída
{
  const { brl, usd, warning } = M.custoBRL({ prompt: 1_000_000, cached: 800_000, completion: 100_000, modelo: "gpt-5.4" }, env);
  // (200k*2.50 + 800k*0.25 + 100k*15)/1e6 = (500000+200000+1500000)/1e6 = 2.2 USD
  assert.ok(Math.abs(usd - 2.2) < 1e-9, "usd=2.2");
  assert.ok(Math.abs(brl - 11.0) < 1e-9, "brl=11.0 (×5)");
  assert.strictEqual(warning, null);
  ok++;
}
// 2) modelo sem preço → fallback conservador + warning (não zera silenciosamente)
{
  const { warning, brl } = M.custoBRL({ prompt: 1000, completion: 100, modelo: "modelo-novo" }, { USD_BRL: "5" });
  assert.ok(warning, "warning presente");
  assert.ok(brl > 0, "usa fallback, não R$ 0");
  ok++;
}
// 3) resumoPeriodo: KPIs
{
  const rows = [
    { usuario_id: "a", tokens_prompt: 1000, tokens_cached: 0, tokens_completion: 100, modelo: "gpt-5.4", gerou_doc: true, tag: "multa", condominio: "lume", criado_em: "2026-07-10T10:00:00Z" },
    { usuario_id: "a", tokens_prompt: 2000, tokens_cached: 0, tokens_completion: 50, modelo: "gpt-5.4", gerou_doc: false, tag: "regimento", condominio: "lume", criado_em: "2026-07-11T10:00:00Z" },
    { usuario_id: "b", tokens_prompt: 500, tokens_cached: 0, tokens_completion: 20, modelo: "gpt-5.4", gerou_doc: false, tag: null, condominio: null, criado_em: "2026-07-10T09:00:00Z" },
  ];
  const r = M.resumoPeriodo(rows, env);
  assert.strictEqual(r.interacoes, 3);
  assert.strictEqual(r.documentos, 1);
  assert.strictEqual(r.pessoasAtivas, 2);
  assert.ok(r.custoBRL > 0);
  ok++;
}
// 4) porTag (null→outro) e porCondominio (null→sem condomínio), ordenados desc
{
  const t = M.porTag([{ tag: "multa" }, { tag: "multa" }, { tag: null }, { tag: "regimento" }]);
  assert.strictEqual(t[0].tag, "multa");
  assert.strictEqual(t[0].n, 2);
  assert.ok(t.find((x) => x.tag === "outro"), "null → outro");
  const c = M.porCondominio([{ condominio: "lume" }, { condominio: null }]);
  assert.ok(c.find((x) => x.condominio === "lume"));
  assert.ok(c.find((x) => x.condominio === "(sem condomínio)"));
  ok++;
}
// 5) porPessoa: dias ativos distintos + custo SÓ com comCusto (admin cliente não vê)
{
  const rows = [
    { usuario_id: "a", tokens_prompt: 1000, tokens_cached: 0, tokens_completion: 100, modelo: "gpt-5.4", gerou_doc: true, criado_em: "2026-07-10T10:00:00Z" },
    { usuario_id: "a", tokens_prompt: 1000, tokens_cached: 0, tokens_completion: 100, modelo: "gpt-5.4", gerou_doc: false, criado_em: "2026-07-10T22:00:00Z" },
    { usuario_id: "a", tokens_prompt: 1000, tokens_cached: 0, tokens_completion: 100, modelo: "gpt-5.4", gerou_doc: false, criado_em: "2026-07-11T09:00:00Z" },
  ];
  const nomes = { a: "Ana Fulana" };
  const semCusto = M.porPessoa(rows, env, { comCusto: false, nomes });
  assert.strictEqual(semCusto[0].nome, "Ana Fulana");
  assert.strictEqual(semCusto[0].interacoes, 3);
  assert.strictEqual(semCusto[0].documentos, 1);
  assert.strictEqual(semCusto[0].diasAtivos, 2, "10 e 11 (BRT) = 2 dias");
  assert.strictEqual(semCusto[0].custoBRL, undefined, "admin cliente NÃO vê custo");
  const comCusto = M.porPessoa(rows, env, { comCusto: true, nomes });
  assert.ok(comCusto[0].custoBRL > 0, "owner vê custo");
  ok++;
}

console.log(`test_metrics: ${ok}/5 OK`);
