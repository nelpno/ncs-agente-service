// Núcleo do motor como BIBLIOTECA — usado tanto pela CLI (gerar.mjs) quanto pelo Estagiário-chat.
// Lança Error em caso de dado inválido (quem chama trata). NÃO contém IA.
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { renderHTML } from "./template.mjs";
import { htmlParaPdf } from "./render-pdf.mjs";

export const RAIZ = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));

const PAPEL = {
  proprietario: { F: "proprietária", M: "proprietário" },
  morador:      { F: "moradora", M: "morador" },
  inquilino:    { F: "inquilina", M: "inquilino" },
  responsavel:  { F: "responsável", M: "responsável" },
};
const ORDINAL_FEM = { 1: "1ª", 2: "2ª", 3: "3ª", 4: "4ª", 5: "5ª" };
const EXTENSO = { 1: "uma", 2: "duas", 3: "três", 4: "quatro", 5: "cinco" };

export function carregarCondominio(condId, raiz = RAIZ) {
  const slug = String(condId).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const p = path.join(raiz, "dados", `${slug}.json`);
  if (!fs.existsSync(p)) throw new Error(`condomínio "${condId}" sem catálogo em dados/ (rode extrair-catalogo.mjs).`);
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

export function listarInfracoes(dados) {
  return Object.entries(dados.catalogo_infracoes).map(([id, v]) => ({
    id, titulo: v.titulo, fundamento: v.fundamento, palavras_chave: v.palavras_chave || [],
  }));
}

export function montarDoc(dados, oc, cadastro) {
  // cadastro do condomínio: vem do Superlógica (ao vivo) quando informado; senão o bloco fixo do catálogo (fallback/CLI).
  const cad = cadastro || dados.condominio;
  if (!cad || !cad.nome) throw new Error("cadastro do condomínio ausente (Superlógica não resolveu e não há bloco fixo no catálogo).");
  const infra = dados.catalogo_infracoes[oc.infracao_id];
  if (!infra) {
    const e = new Error(`infração "${oc.infracao_id}" não existe no catálogo de ${dados.id}.`);
    e.infracoes_disponiveis = Object.keys(dados.catalogo_infracoes);
    throw e;
  }
  if (!oc.destinatario?.nome || !oc.destinatario?.apartamento) throw new Error("destinatario.nome e destinatario.apartamento são obrigatórios.");
  if (!oc.relato) throw new Error("relato (parágrafo da ocorrência) é obrigatório.");
  if (!oc.data_documento) throw new Error("data_documento é obrigatória.");

  const g = (oc.destinatario.genero || "M").toUpperCase();
  const papelNome = (PAPEL[oc.destinatario.papel] || PAPEL.responsavel)[g] || "condômino(a)";
  const tratamento = g === "F" ? "À Sra." : "Ao Sr.";
  const saudacao = `${tratamento} ${oc.destinatario.nome}, ${papelNome} do apartamento ${oc.destinatario.apartamento},`;

  let titulo, penalidade_paragrafo = null;
  if (oc.tipo === "multa") {
    const nivel = oc.nivel_reincidencia || 1;
    titulo = nivel > 1 ? `NOTIFICAÇÃO COM MULTA — ${ORDINAL_FEM[nivel] || nivel + "ª"} REINCIDÊNCIA` : "NOTIFICAÇÃO COM MULTA";
    const p = oc.penalidade || {};
    const taxas = p.taxas ?? dados.regra_multa?.taxas_sugeridas_por_nivel?.[String(nivel)] ?? nivel;
    if (!p.mes_boleto) throw new Error("penalidade.mes_boleto é obrigatório para tipo=multa.");
    const numFmt = String(taxas).padStart(2, "0");
    const ext = EXTENSO[taxas] || taxas;
    const plural = taxas > 1 ? "taxas condominiais" : "taxa condominial";
    penalidade_paragrafo =
      `Diante do descumprimento das normas, informamos que será aplicada multa condominial ` +
      `correspondente a ${numFmt} (${ext}) ${plural}, a qual será lançada no boleto de cobrança ` +
      `referente ao mês de ${p.mes_boleto}, sem prejuízo de novas penalidades em caso de manutenção da irregularidade.`;
  } else if (oc.tipo === "notificacao") {
    titulo = "NOTIFICAÇÃO";
  } else {
    throw new Error(`tipo "${oc.tipo}" inválido. Use "notificacao" ou "multa".`);
  }

  return {
    condominio: {
      nome: cad.nome, endereco: cad.endereco,
      cep: cad.cep, cidade_uf: cad.cidade_uf,
    },
    titulo, saudacao,
    fundamento: `Considerando o que dispõe o ${infra.fundamento},`,
    texto_artigo: infra.texto_artigo,
    relato: oc.relato,
    penalidade_paragrafo,
    convencao: dados.convencao_penalidades,
    fecho: "Agradecemos pela sua compreensão e cooperação.",
    local_data: `${cad.cidade_fecho || cad.cidade_uf}, ${oc.data_documento}.`,
    assinatura: dados.responsavel,
    marca_dagua: oc.marca_revisao
      ? "Minuta gerada por assistente NCS — conferir e assinar (responsável pelo condomínio)."
      : null,
  };
}

export function slug(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

/** gerarDocumento({ ocorrencia, destino?, raiz?, cadastro? }) -> { destino, titulo }
 *  cadastro (do Superlógica) é opcional; sem ele, usa o bloco fixo do catálogo (CLI/fallback). */
export function gerarDocumento({ ocorrencia, destino, raiz = RAIZ, cadastro }) {
  const dados = carregarCondominio(ocorrencia.condominio, raiz);
  const doc = montarDoc(dados, ocorrencia, cadastro);
  const html = renderHTML(doc);
  if (!destino) {
    const nome = `${slug(ocorrencia.condominio)}_${ocorrencia.tipo}_${slug(ocorrencia.infracao_id)}_ap${slug(ocorrencia.destinatario.apartamento)}.pdf`;
    destino = path.join(raiz, "saida", nome);
  }
  htmlParaPdf(html, destino);
  return { destino, titulo: doc.titulo };
}
