// relatorio.mjs — tool do Estagiário: gera o PDF do RELATÓRIO DE PRESTAÇÃO DE CONTAS mensal.
// Números 100% do Superlógica (motor determinístico); o LLM só redige o resumo executivo sobre os números.
// Resolve o condo pelo NOME (funciona p/ todos, sem catálogo). Render via gerador/render-pdf.mjs (container-ready).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { montarRelatorio } from "../../gerador-relatorio-contas/src/gerar-core.mjs";
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
  let mes = d.getMonth();           // getMonth()=0-11; o mês anterior (fechado) = número do mês corrente-1 => índice 0 = dezembro do ano passado
  let ano = d.getFullYear();
  if (mes === 0) { mes = 12; ano -= 1; } // janeiro → dezembro do ano anterior
  return { mes, ano };
}

/**
 * gerar_relatorio_prestacao_contas({ condominio, mes?, ano? }) → { ok, url:/doc/<arq>, titulo, resumo }
 * Só GET no Superlógica; o gate de orçamento (só condo default confiável) vive no motor.
 */
export async function gerar_relatorio_prestacao_contas({ condominio, mes, ano } = {}) {
  try {
    const cond = await resolver_condominio({ nome: condominio });
    if (!cond.encontrado) return { ok: false, motivo: "condominio_nao_encontrado", detalhe: cond.motivo, opcoes: cond.opcoes };

    const def = ultimoMesFechado();
    const M = normMes(mes) || def.mes;
    const Y = Number(ano) || (normMes(mes) ? new Date().getFullYear() : def.ano);

    const { modelo, texto, html } = await montarRelatorio({ idCondominio: cond.id, ano: Y, mes: M, nome: cond.nome, chat });

    fs.mkdirSync(SAIDA, { recursive: true });
    const arquivo = `prestacao-contas_${slugId(cond.nome)}_${Y}-${String(M).padStart(2, "0")}_${Date.now().toString(36)}.pdf`;
    htmlParaPdf(html, path.join(SAIDA, arquivo));

    return {
      ok: true,
      titulo: `Prestação de Contas — ${cond.nome} — ${MESES[M]}/${Y}`,
      arquivo,
      url: `/doc/${arquivo}`,
      periodo: `${MESES[M]}/${Y}`,
      resumo: {
        receitas: modelo.receitas.total,
        despesas: modelo.despesas.total,
        resultado: modelo.resultado.valor,
        tipo: modelo.resultado.tipo,
        com_previsao_orcamentaria: modelo.temOrcamento,
        alertas: modelo.alertas.length,
      },
      texto_fonte: texto.fonte,
    };
  } catch (e) { return { ok: false, motivo: "erro", detalhe: e.message }; }
}
