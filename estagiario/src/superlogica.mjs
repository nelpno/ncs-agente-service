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

/** resolver_morador({id_condominio, unidade, bloco?}) → responsável(eis) da unidade (nome + papel), ao vivo. */
export async function resolver_morador({ id_condominio, unidade, bloco } = {}) {
  if (!id_condominio || !unidade) return { encontrado: false, motivo: "preciso do condomínio e do número da unidade" };
  const resp = await slGet("responsaveis/index", { idCondominio: id_condominio, itensPorPagina: 500 });
  const arr = Array.isArray(resp) ? resp : (resp && resp.data) || [];
  const u = String(unidade).trim();
  const b = bloco != null && bloco !== "" ? String(bloco).trim() : null;
  const hit = arr.filter((r) => String(r.st_unidade_uni).trim() === u && (!b || String(r.st_bloco_uni).trim() === b));
  if (!hit.length) return { encontrado: false, motivo: `nenhum responsável na unidade ${unidade}${b ? " bloco " + b : ""}` };
  const moradores = hit.map((r) => ({
    nome: r.st_nome_con,
    papel: PAPEL_LABEL[r.id_label_tres] || "responsavel",
    papel_descricao: r.st_nometiporesp_tres,
    apartamento: [r.st_unidade_uni, r.st_bloco_uni].filter(Boolean).join(" "),
  }));
  return { encontrado: true, moradores };
}
