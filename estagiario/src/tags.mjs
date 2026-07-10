// tags.mjs — classifica cada turno por DEMANDA, de forma determinística (custo/latência zero).
// Precedência (spec §4.5): tool que GERA doc > tool de CONSULTA > tool auxiliar (cadastro) > null (async).
// Sem precedência, um turno de multa (que chama buscar_morador) seria rotulado "cadastro" por engano.

export const TAXONOMIA = ["multa", "notificação", "cnd", "prestação-contas", "regimento", "mudança", "portaria", "app/dúvida", "cadastro", "outro"];

// 1) tools que GERAM documento (maior precedência)
const DOC_TAG = {
  gerar_documento: (a) => (a?.tipo === "multa" ? "multa" : "notificação"),
  gerar_cnd: () => "cnd",
  gerar_relatorio_prestacao_contas: () => "prestação-contas",
  gerar_relatorio_periodo: () => "prestação-contas",
  analisar_condominio: () => "prestação-contas",
};
// 2) tools de CONSULTA
const CONSULTA_TAG = {
  consultar_regimento: "regimento",
  consultar_regra_mudanca: "mudança",
  consultar_sistema_portaria: "portaria",
  consultar_video_app: "app/dúvida",
  consultar_base_geral: "app/dúvida",
};
// 3) auxiliares (só rotulam se forem a única categoria presente)
const AUX = new Set(["listar_infracoes", "buscar_morador"]);

const nomes = (t) => (t || []).map((x) => x?.name);

export function tagDeterministica(toolsUsed) {
  const tools = toolsUsed || [];
  for (const t of tools) if (DOC_TAG[t.name]) return DOC_TAG[t.name](t.args);
  for (const t of tools) if (CONSULTA_TAG[t.name]) return CONSULTA_TAG[t.name];
  for (const t of tools) if (AUX.has(t.name)) return "cadastro";
  return null; // sem tool → o classificador assíncrono (Chunk 6) decide; painel trata null como "outro"
}

function normCondo(v) {
  if (!v || typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return s || null;
}

// O condomínio segue a MESMA precedência da tag (o do documento/consulta que "ganhou").
export function condominioDeArgs(toolsUsed) {
  const tools = toolsUsed || [];
  for (const t of tools) if (DOC_TAG[t.name] && t.args?.condominio) return normCondo(t.args.condominio);
  for (const t of tools) if (CONSULTA_TAG[t.name] && t.args?.condominio) return normCondo(t.args.condominio);
  for (const t of tools) if (t.args?.condominio) return normCondo(t.args.condominio);
  return null;
}

// Tipo do documento (coluna interacoes.tipo_doc) — só quando uma tool geradora foi chamada.
export function tipoDoc(toolsUsed) {
  for (const t of toolsUsed || []) {
    if (t.name === "gerar_documento") return t.args?.tipo === "multa" ? "multa" : "notificacao";
    if (t.name === "gerar_cnd") return "cnd";
    if (t.name === "gerar_relatorio_prestacao_contas" || t.name === "gerar_relatorio_periodo") return "relatorio";
    if (t.name === "analisar_condominio") return "analise";
  }
  return null;
}

export { nomes };
