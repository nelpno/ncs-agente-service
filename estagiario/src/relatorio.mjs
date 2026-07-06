// relatorio.mjs — tools do Estagiário para o RELATÓRIO DE PRESTAÇÃO DE CONTAS:
//   • gerar_relatorio_prestacao_contas  (1 mês)
//   • gerar_relatorio_periodo           (intervalo consolidado, ex.: jan→mai — o "11A" da Superlógica)
//   • analisar_condominio               (leitura + recomendação advisory sobre os números)
// Números 100% Superlógica (motor determinístico); o LLM só redige prosa/recomendação SOBRE os números.
// Saída em PDF ou WORD editável (mesmo HTML servido como .doc — sem dependência nova, abre no Word).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { montarRelatorio } from "../../gerador-relatorio-contas/src/gerar-core.mjs";
import { montarRelatorioPeriodo } from "../../gerador-relatorio-contas/src/periodo.mjs";
import { renderHTMLAnalise } from "../../gerador-relatorio-contas/src/template-periodo.mjs";
import { textoRecomendacao } from "../../gerador-relatorio-contas/src/texto-executivo.mjs";
import { htmlParaPdf } from "../../gerador/src/render-pdf.mjs";
import { chat } from "../../src/llm.mjs";
import { resolver_condominio } from "./superlogica.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAIDA = path.join(__dirname, "..", "saida");

const MESES = ["", "janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function slugId(s) {
  return String(s).normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

// mês: aceita número (1-12), "6", ou nome ("junho"). Retorna 1-12 ou null.
function normMes(x) {
  if (x == null || x === "") return null;
  const n = Number(x);
  if (Number.isInteger(n) && n >= 1 && n <= 12) return n;
  const s = String(x).toLowerCase().normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "").trim();
  const i = MESES.map(m => m.normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "")).indexOf(s);
  return i > 0 ? i : null;
}

// último mês FECHADO (o mês anterior ao atual)
function ultimoMesFechado() {
  const d = new Date();
  let mes = d.getMonth(); // getMonth()=0-11 → o mês anterior (fechado)
  let ano = d.getFullYear();
  if (mes === 0) { mes = 12; ano -= 1; } // janeiro → dezembro do ano anterior
  return { mes, ano };
}

// período padrão da análise: do início do ano até o último mês fechado (ou o ano anterior inteiro em janeiro)
function periodoDefault() {
  const d = new Date();
  const mc = d.getMonth() + 1;
  if (mc === 1) return { ano: d.getFullYear() - 1, mesInicio: 1, mesFim: 12 };
  return { ano: d.getFullYear(), mesInicio: 1, mesFim: mc - 1 };
}

// Envolve o HTML para o Word abrir como DOCUMENTO editável (não como página web).
// ⚠️ Gráficos SVG podem não renderizar no Word (tabelas/texto sim) — o valor editável está no texto/tabelas.
function htmlParaWord(html) {
  const mso = `<meta name=ProgId content=Word.Document><meta name=Originator content="Microsoft Word 15">` +
    `<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->`;
  return html.replace(/<head>/i, "<head>" + mso);
}

// grava o documento no formato pedido e devolve { arquivo, url, formato }
function entregar(html, base, formato) {
  fs.mkdirSync(SAIDA, { recursive: true });
  const word = /^(word|doc|docx)$/i.test(formato || "");
  const arquivo = `${base}_${Date.now().toString(36)}.${word ? "doc" : "pdf"}`;
  const destino = path.join(SAIDA, arquivo);
  if (word) fs.writeFileSync(destino, htmlParaWord(html), "utf8");
  else htmlParaPdf(html, destino);
  return { arquivo, url: `/doc/${arquivo}`, formato: word ? "word" : "pdf" };
}

/**
 * gerar_relatorio_prestacao_contas({ condominio, mes?, ano?, formato? }) → { ok, url, titulo, resumo }
 */
export async function gerar_relatorio_prestacao_contas({ condominio, mes, ano, formato } = {}) {
  try {
    const cond = await resolver_condominio({ nome: condominio });
    if (!cond.encontrado) return { ok: false, motivo: "condominio_nao_encontrado", detalhe: cond.motivo, opcoes: cond.opcoes };

    const def = ultimoMesFechado();
    const M = normMes(mes) || def.mes;
    const Y = Number(ano) || (normMes(mes) ? new Date().getFullYear() : def.ano);

    const { modelo, texto, html } = await montarRelatorio({ idCondominio: cond.id, ano: Y, mes: M, nome: cond.nome, chat });
    const out = entregar(html, `prestacao-contas_${slugId(cond.nome)}_${Y}-${String(M).padStart(2, "0")}`, formato);

    return {
      ok: true,
      titulo: `Prestação de Contas — ${cond.nome} — ${MESES[M]}/${Y}`,
      arquivo: out.arquivo, url: out.url, formato: out.formato, periodo: `${MESES[M]}/${Y}`,
      resumo: {
        receitas: modelo.receitas.total, despesas: modelo.despesas.total,
        resultado: modelo.resultado.valor, tipo: modelo.resultado.tipo,
        com_previsao_orcamentaria: modelo.temOrcamento, alertas: modelo.alertas.length,
      },
      texto_fonte: texto.fonte,
    };
  } catch (e) { return { ok: false, motivo: "erro", detalhe: e.message }; }
}

/**
 * gerar_relatorio_periodo({ condominio, mes_inicio, mes_fim, ano?, formato? }) → { ok, url, titulo, resumo }
 * Relatório consolidado de um intervalo (ex.: jan→mai): acumulado + tabela mês a mês + gráficos.
 */
export async function gerar_relatorio_periodo({ condominio, mes_inicio, mes_fim, ano, formato } = {}) {
  try {
    const cond = await resolver_condominio({ nome: condominio });
    if (!cond.encontrado) return { ok: false, motivo: "condominio_nao_encontrado", detalhe: cond.motivo, opcoes: cond.opcoes };

    const mi = normMes(mes_inicio), mf = normMes(mes_fim);
    if (!mi || !mf) return { ok: false, motivo: "periodo_invalido", detalhe: "Informe o mês inicial e final (ex.: janeiro a maio)." };
    if (mi > mf) return { ok: false, motivo: "periodo_invalido", detalhe: "O mês inicial não pode ser depois do mês final." };
    const Y = Number(ano) || new Date().getFullYear();

    const { modelo, texto, html } = await montarRelatorioPeriodo({ idCondominio: cond.id, ano: Y, mesInicio: mi, mesFim: mf, nome: cond.nome, chat });
    const out = entregar(html, `prestacao-periodo_${slugId(cond.nome)}_${Y}-${String(mi).padStart(2, "0")}-${String(mf).padStart(2, "0")}`, formato);

    return {
      ok: true,
      titulo: `Prestação de Contas — ${cond.nome} — ${modelo.periodo.label}`,
      arquivo: out.arquivo, url: out.url, formato: out.formato, periodo: modelo.periodo.label,
      resumo: {
        meses: modelo.periodo.nMeses,
        receitas: modelo.receitas.total, despesas: modelo.despesas.total,
        resultado: modelo.resultado.valor, tipo: modelo.resultado.tipo,
        meses_positivos: modelo.resultado.mesesPositivos,
        por_mes: modelo.porMes.map(x => ({ mes: x.mesNome, resultado: Math.round(x.resultado) })),
        com_previsao_orcamentaria: modelo.temOrcamento, alertas: modelo.alertas.length,
      },
      texto_fonte: texto.fonte,
    };
  } catch (e) { return { ok: false, motivo: "erro", detalhe: e.message }; }
}

/**
 * analisar_condominio({ condominio, mes_inicio?, mes_fim?, ano?, formato? }) → { ok, url, titulo, recomendacao }
 * Leitura consultiva + RECOMENDAÇÃO (advisory) sobre os números do período. Sem período → ano corrente até o último mês fechado.
 */
export async function analisar_condominio({ condominio, mes_inicio, mes_fim, ano, formato } = {}) {
  try {
    const cond = await resolver_condominio({ nome: condominio });
    if (!cond.encontrado) return { ok: false, motivo: "condominio_nao_encontrado", detalhe: cond.motivo, opcoes: cond.opcoes };

    const d = periodoDefault();
    const mi = normMes(mes_inicio) || d.mesInicio;
    const mf = normMes(mes_fim) || d.mesFim;
    const Y = Number(ano) || d.ano;
    if (mi > mf) return { ok: false, motivo: "periodo_invalido", detalhe: "O mês inicial não pode ser depois do mês final." };

    const { modelo, texto } = await montarRelatorioPeriodo({ idCondominio: cond.id, ano: Y, mesInicio: mi, mesFim: mf, nome: cond.nome, chat });
    const recom = await textoRecomendacao(modelo, { chat });
    const html = renderHTMLAnalise(modelo, recom, texto);
    const out = entregar(html, `analise_${slugId(cond.nome)}_${Y}-${String(mi).padStart(2, "0")}-${String(mf).padStart(2, "0")}`, formato);

    return {
      ok: true,
      titulo: `Análise e Recomendações — ${cond.nome} — ${modelo.periodo.label}`,
      arquivo: out.arquivo, url: out.url, formato: out.formato, periodo: modelo.periodo.label,
      recomendacao: recom.resumo,
      resumo: {
        receitas: modelo.receitas.total, despesas: modelo.despesas.total,
        resultado: modelo.resultado.valor, tipo: modelo.resultado.tipo,
        media_mensal: Math.round(modelo.resultado.media), meses_positivos: modelo.resultado.mesesPositivos,
      },
      texto_fonte: recom.fonte,
    };
  } catch (e) { return { ok: false, motivo: "erro", detalhe: e.message }; }
}

export { SAIDA };
