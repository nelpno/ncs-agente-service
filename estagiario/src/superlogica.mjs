// superlogica.mjs (Chat NCS) — LEITURA do cadastro de condomínio e morador p/ compor o documento.
// SOMENTE GET. Reusa a autenticação da Ana (config: slBase/slApp/slAccess). Cache da lista de condomínios.
import { config } from "../../src/config.mjs";

async function slGet(controllerAction, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${config.slBase}/${controllerAction}${qs ? "?" + qs : ""}`, {
    headers: { app_token: config.slApp, access_token: config.slAccess, "Content-Type": "application/json" },
  });
  if (!r.ok) throw new Error(`Superlógica ${controllerAction} ${r.status}`);
  return r.json();
}

const norm = (s) => (s || "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

let _condos = null;
async function listaCondos() {
  if (_condos) return _condos;
  const d = await slGet("condominios/get", { id: -1 });
  _condos = Array.isArray(d) ? d : [];
  return _condos;
}

// O endpoint honra itensPorPagina=500, mas trunca em silêncio acima disso — condomínio grande
// perderia unidades e o robô responderia "não encontrei" com confiança. Pagina até o fim.
async function todosResponsaveis(id_condominio) {
  const LOTE = 500;
  let todos = [], pagina = 1;
  for (;;) {
    const resp = await slGet("responsaveis/index", { idCondominio: id_condominio, itensPorPagina: LOTE, pagina });
    const arr = Array.isArray(resp) ? resp : (resp && resp.data) || [];
    todos = todos.concat(arr);
    if (arr.length < LOTE || pagina >= 20) break;
    pagina++;
  }
  return todos;
}

/** resolver_condominio({nome}) → cadastro pronto p/ o cabeçalho do documento (ao vivo). */
export async function resolver_condominio({ nome } = {}) {
  if (!nome) return { encontrado: false, motivo: "informe o nome do condomínio" };
  const condos = await listaCondos();
  const q = norm(nome);
  let hit = condos.filter((c) => norm(c.st_fantasia_cond) === q || norm(c.st_nome_cond) === q);
  if (!hit.length) hit = condos.filter((c) => norm(c.st_fantasia_cond).includes(q) || norm(c.st_nome_cond).includes(q));
  if (!hit.length) return { encontrado: false, motivo: "condomínio não encontrado no Superlógica" };
  if (hit.length > 1) return { encontrado: false, motivo: "vários condomínios batem — especifique", opcoes: hit.map((c) => c.st_fantasia_cond).slice(0, 8) };
  const c = hit[0];
  const enderecoNum = c.st_numeroendereco_cond ? `${c.st_endereco_cond}, ${c.st_numeroendereco_cond}` : c.st_endereco_cond;
  return {
    encontrado: true,
    id: c.id_condominio_cond,
    nome: (c.st_nome_cond || c.st_fantasia_cond || "").toUpperCase(),
    endereco: [enderecoNum, c.st_bairro_cond].filter(Boolean).join(" - ").toUpperCase(),
    cep: c.st_cep_cond || "",
    cidade_uf: [c.st_cidade_cond, c.st_uf_uf].filter(Boolean).join("/").toUpperCase(),
    cidade_fecho: c.st_cidade_cond || "",
  };
}

const PAPEL_LABEL = { 1: "proprietario", 2: "proprietario", 7: "inquilino", 4: "dependente", 3: "imobiliaria", 999: "procurador" };

// Rótulo + zero à esquerda: o Superlógica grava a unidade de um jeito diferente em cada condomínio
// ("APTO 0101"+"BLOCO 01", "0303"+"BL 18", "0091"+"Edifício V", "1501"+"APTO"), mas a equipe digita
// "apto 101 bloco 1". Normaliza os DOIS lados para comparar. Determinístico — nunca aproximado.
const _normUni = (s) => String(s ?? "").toLowerCase().normalize("NFD")
  .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
  .replace(/\b(apartamento|apto|apt|ap|unidade|un|bloco|bl|torre|tr|edificio|ed|casa|sala|quadra|qd)\b\.?/g, " ")
  .replace(/[^a-z0-9]+/g, " ").trim()
  .split(" ").filter(Boolean)
  .map((p) => (/^\d+$/.test(p) ? String(parseInt(p, 10)) : p)).join(" ");

/**
 * Acha as linhas de UMA unidade. Puro (testável sem rede) — ver test/test_unidade_match.mjs.
 * Passada 1: match exato (quem digita como está gravado sempre ganha — no Tivoli "10 G" e "010 G"
 * são unidades DIFERENTES, de donos diferentes). Passada 2: normalizado, só se a exata não achou nada.
 * ⚠️ O documento tem peso jurídico: se sobrar mais de uma unidade DISTINTA, devolve "ambiguo" para
 * perguntar — nunca escolhe. Várias pessoas na MESMA unidade é o caso normal e não é ambiguidade.
 */
export function _acharUnidade(rows, { unidade, bloco } = {}) {
  const u = String(unidade ?? "").trim();
  if (!u) return { status: "nao_encontrado" };
  const b = bloco != null && bloco !== "" ? String(bloco).trim() : null;
  let hits = rows.filter((r) => String(r.st_unidade_uni).trim() === u && (!b || String(r.st_bloco_uni).trim() === b));
  if (!hits.length) {
    const nu = _normUni(u), nb = b ? _normUni(b) : null;
    hits = rows.filter((r) => _normUni(r.st_unidade_uni) === nu && (!nb || _normUni(r.st_bloco_uni) === nb));
  }
  if (!hits.length) return { status: "nao_encontrado" };
  const ids = [...new Set(hits.map((r) => r.id_unidade_uni))];
  if (ids.length > 1) {
    const opcoes = [...new Set(hits.map((r) => [String(r.st_unidade_uni).trim(), String(r.st_bloco_uni || "").trim()].filter(Boolean).join(" ")))];
    return { status: "ambiguo", opcoes };
  }
  return { status: "ok", linhas: hits };
}

/** resolver_morador({id_condominio, unidade, bloco?}) → responsável(eis) da unidade (nome + papel), ao vivo. */
export async function resolver_morador({ id_condominio, unidade, bloco } = {}) {
  if (!id_condominio || !unidade) return { encontrado: false, motivo: "preciso do condomínio e do número da unidade" };
  const arr = await todosResponsaveis(id_condominio);
  const b = bloco != null && bloco !== "" ? String(bloco).trim() : null;
  const r0 = _acharUnidade(arr, { unidade, bloco });
  if (r0.status === "ambiguo") {
    return { encontrado: false, motivo: "ambiguo", opcoes: r0.opcoes,
      detalhe: `mais de uma unidade bate com "${unidade}"${b ? ` bloco ${b}` : ""} — confirme qual` };
  }
  if (r0.status !== "ok") return { encontrado: false, motivo: `nenhum responsável na unidade ${unidade}${b ? " bloco " + b : ""}` };
  const hit = r0.linhas;
  const moradores = hit.map((r) => ({
    nome: r.st_nome_con,
    papel: PAPEL_LABEL[r.id_label_tres] || "responsavel",
    papel_descricao: r.st_nometiporesp_tres,
    apartamento: [r.st_unidade_uni, r.st_bloco_uni].filter(Boolean).join(" "),
    id_unidade: r.id_unidade_uni, // p/ tools que precisam do id da unidade (ex.: CND)
  }));
  return { encontrado: true, moradores };
}
