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

// formatCnpj: mascara SÓ se vier o CNPJ padrão (14 dígitos); qualquer outra coisa devolve cru — nunca
// inventa nem força máscara errada (anti-alucinação: o valor é do ERP).
function formatCnpj(v) {
  const d = String(v || "").replace(/\D/g, "");
  if (d.length !== 14) return String(v || "").trim();
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

// extrairCnpj: ⚠️ o CNPJ do condomínio vem, na prática, no campo **`st_cpf_cond`** (nome enganoso — guarda
// o CNPJ de 14 dígitos; `st_cnpj_cond` vem VAZIO). Confirmado ao vivo (Lume: st_cpf_cond=56300773000148,
// st_cnpj_cond=""). Pega o PRIMEIRO campo com 14 dígitos (formato CNPJ) e ignora 11 dígitos (CPF de condo
// PF — não rotular como CNPJ). Vazio se nenhum tiver cara de CNPJ (nunca inventa).
export function extrairCnpj(c) {
  for (const f of ["st_cnpj_cond", "st_cpf_cond", "st_cgc_cond", "st_cgc_con"]) {
    const d = String(c?.[f] || "").replace(/\D/g, "");
    if (d.length === 14) return formatCnpj(d);
  }
  return "";
}

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

/** resolver_condominio({nome}, deps?) → cadastro pronto p/ o cabeçalho do documento (ao vivo). deps.condos injetável (teste). */
export async function resolver_condominio({ nome } = {}, deps = {}) {
  if (!nome) return { encontrado: false, motivo: "informe o nome do condomínio" };
  const condos = deps.condos || await listaCondos();
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
    cnpj: extrairCnpj(c), // ⚠️ vem em st_cpf_cond na prática (st_cnpj_cond vazio); síndico é à parte (sindicos/index)
  };
}

/**
 * resolver_sindico(id_condominio, deps?) → o SÍNDICO ATUAL, ao vivo (sindicos/index?comStatus=atuais).
 * O endpoint devolve a diretoria inteira (5+ itens: síndico, subsíndico, conselho, porteiro, administradora).
 * ⚠️ O cargo do síndico VARIA: CONDOMÍNIO usa "Síndico" (Lume: Alexandre); ASSOCIAÇÃO usa "Presidente"
 * (Tivoli: Gilsandro) — confirmado ao vivo 23/07. Filtro: cargo == "síndico" (exato, ≠ subsíndico) ou que
 * contém "presidente" MAS não "vice"/"sub". Campos: st_nome_sin / st_cargo_sin / st_email_sin. deps.sindicos injetável.
 */
export async function resolver_sindico(id_condominio, deps = {}) {
  if (!id_condominio) return { encontrado: false, motivo: "informe o condomínio" };
  let dados;
  try { dados = deps.sindicos || await slGet("sindicos/index", { idCondominio: id_condominio, comStatus: "atuais" }); }
  catch { return { encontrado: false, motivo: "consulta indisponível" }; }
  const lista = Array.isArray(dados) ? dados : (dados && dados.data) || [];
  const cargo = (s) => norm(s.st_cargo_sin || "");
  let hit = lista.find((s) => cargo(s) === "sindico");
  if (!hit) hit = lista.find((s) => /\bpresidente\b/.test(cargo(s)) && !/vice|sub/.test(cargo(s)));
  if (!hit || !hit.st_nome_sin) return { encontrado: false, motivo: "síndico não localizado no cadastro" };
  return {
    encontrado: true,
    nome: String(hit.st_nome_sin).trim(),
    cargo: String(hit.st_cargo_sin || "Síndico").trim(),
    email: hit.st_email_sin || null,
    telefone: hit.st_telefone_sin || hit.st_celular_sin || null,
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

/**
 * candidatosUnidade(rows, {unidade, bloco?}, limit) — quando _acharUnidade dá "nao_encontrado", devolve
 * uma LISTA de unidades distintas do condomínio, rankeadas por proximidade, COM o(s) responsável(is), pro
 * Estagiário mostrar "achei estas parecidas: 0503 Bloco 1 (Santa Barbara)…" em vez do beco "digite exatamente
 * como está no sistema" (caso Jatiúca, 23/07: a equipe não sabia o formato e ficou adivinhando). Pura/testável.
 * NUNCA escolhe (o documento/CND tem peso jurídico) — só oferece a lista pra a equipe reconhecer pelo nome.
 */
export function candidatosUnidade(rows, { unidade, bloco } = {}, limit = 6) {
  const nu = _normUni(unidade || ""), nb = bloco ? _normUni(bloco) : null;
  const mapa = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const k = r.id_unidade_uni; if (k == null) continue;
    if (!mapa.has(k)) mapa.set(k, { id: k, unidade: String(r.st_unidade_uni || "").trim(), bloco: String(r.st_bloco_uni || "").trim(), nomes: [] });
    if (r.st_nome_con) mapa.get(k).nomes.push(r.st_nome_con);
  }
  let cands = [...mapa.values()];
  // Se a equipe informou o bloco e ele existe, foca nele (senão a lista vira o condomínio inteiro).
  if (nb) { const mb = cands.filter((c) => _normUni(c.bloco) === nb); if (mb.length) cands = mb; }
  const num = parseInt(nu, 10);
  const score = (c) => {
    const cu = _normUni(c.unidade); let s = 0;
    if (nb && _normUni(c.bloco) === nb) s += 5;                 // mesmo bloco
    if (nu && cu === nu) s += 4;                                 // número igual normalizado
    else if (nu && (cu.includes(nu) || nu.includes(cu))) s += 2; // contém / é contido
    const cn = parseInt(cu, 10);
    if (Number.isFinite(num) && Number.isFinite(cn)) s += Math.max(0, 2 - Math.abs(num - cn) / 50); // proximidade numérica
    return s;
  };
  return cands.map((c) => ({ c, s: score(c) })).sort((a, b) => b.s - a.s).slice(0, limit)
    .map(({ c }) => ({ id: c.id, label: [c.unidade, c.bloco].filter(Boolean).join(" "), responsaveis: [...new Set(c.nomes)].slice(0, 2) }));
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
  if (r0.status !== "ok") {
    // Beco-sem-saída vira pick-list: candidatos (com responsável) pra a equipe reconhecer, em vez de re-adivinhar.
    const candidatos = candidatosUnidade(arr, { unidade, bloco }, 6);
    return { encontrado: false, motivo: `nenhum responsável na unidade ${unidade}${b ? " bloco " + b : ""}`, ...(candidatos.length ? { candidatos } : {}) };
  }
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
