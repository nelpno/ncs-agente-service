// test_tags.mjs — tag determinística por PRECEDÊNCIA (doc > consulta > auxiliar), + condomínio e tipo_doc.
import assert from "node:assert";
const { tagDeterministica, condominioDeArgs, tipoDoc, TAXONOMIA } = await import("../src/tags.mjs");
let ok = 0;
const T = (name, args = {}) => ({ name, args });

// 1) precedência: doc vence auxiliares (turno de multa chama listar_infracoes+buscar_morador+gerar_documento)
{
  const tools = [T("listar_infracoes", { condominio: "lume" }), T("buscar_morador", { condominio: "lume", unidade: "132" }), T("gerar_documento", { tipo: "multa", condominio: "lume" })];
  assert.strictEqual(tagDeterministica(tools), "multa", "gerar_documento(multa) vence os auxiliares");
  assert.strictEqual(condominioDeArgs(tools), "lume");
  assert.strictEqual(tipoDoc(tools), "multa");
  ok++;
}

// 2) notificação, cnd, prestação-contas
{
  assert.strictEqual(tagDeterministica([T("gerar_documento", { tipo: "notificacao" })]), "notificação");
  assert.strictEqual(tagDeterministica([T("gerar_cnd", { condominio: "x" })]), "cnd");
  assert.strictEqual(tagDeterministica([T("gerar_relatorio_prestacao_contas", { condominio: "x" })]), "prestação-contas");
  assert.strictEqual(tagDeterministica([T("gerar_relatorio_periodo", { condominio: "x" })]), "prestação-contas");
  assert.strictEqual(tagDeterministica([T("analisar_condominio", { condominio: "x" })]), "prestação-contas");
  ok++;
}

// 3) consultas (2ª precedência)
{
  assert.strictEqual(tagDeterministica([T("consultar_regimento", { condominio: "lume" })]), "regimento");
  assert.strictEqual(tagDeterministica([T("consultar_regra_mudanca", { condominio: "x" })]), "mudança");
  assert.strictEqual(tagDeterministica([T("consultar_sistema_portaria", { condominio: "x" })]), "portaria");
  assert.strictEqual(tagDeterministica([T("consultar_video_app", { assunto: "boleto" })]), "app/dúvida");
  assert.strictEqual(tagDeterministica([T("consultar_base_geral", { pergunta: "x" })]), "app/dúvida");
  ok++;
}

// 4) auxiliar sozinho → cadastro; nada → null (vai pro classificador async)
{
  assert.strictEqual(tagDeterministica([T("buscar_morador", { condominio: "x", unidade: "12" })]), "cadastro");
  assert.strictEqual(tagDeterministica([T("listar_infracoes", { condominio: "x" })]), "cadastro");
  assert.strictEqual(tagDeterministica([]), null, "sem tool → null (async decide)");
  ok++;
}

// 5) consulta + auxiliar → consulta vence; regimento sem condominio na tool de doc pega da consulta
{
  assert.strictEqual(tagDeterministica([T("buscar_morador", { condominio: "y" }), T("consultar_regimento", { condominio: "y" })]), "regimento");
  // condomínio segue a precedência: doc sem condominio, consulta com → pega da consulta
  const tools = [T("gerar_documento", { tipo: "multa" }), T("consultar_regimento", { condominio: "vancouver" })];
  assert.strictEqual(condominioDeArgs(tools), "vancouver");
  ok++;
}

// 6) taxonomia fechada + normalização do condomínio
{
  assert.ok(Array.isArray(TAXONOMIA) && TAXONOMIA.includes("outro") && TAXONOMIA.includes("multa"));
  assert.strictEqual(condominioDeArgs([T("consultar_regimento", { condominio: "  Lume  " })]), "lume", "trim+lowercase");
  assert.strictEqual(condominioDeArgs([]), null);
  assert.strictEqual(tipoDoc([T("consultar_regimento", {})]), null, "consulta não é doc");
  ok++;
}

console.log(`test_tags: ${ok}/6 OK`);
