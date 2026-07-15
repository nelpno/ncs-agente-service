// Núcleo do motor como BIBLIOTECA — usado tanto pela CLI (gerar.mjs) quanto pelo Estagiário-chat.
// Lança Error em caso de dado inválido (quem chama trata). NÃO contém IA.
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { renderHTML } from "./template.mjs";
import { htmlParaPdf } from "./render-pdf.mjs";
import { htmlParaWord } from "./render-word.mjs";

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
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const dir = path.join(raiz, "dados");
  const alvo = norm(condId);
  // 1) slug direto (arquivo <slug>.json)
  const direto = path.join(dir, `${alvo}.json`);
  if (fs.existsSync(direto)) return JSON.parse(fs.readFileSync(direto, "utf-8"));
  // 2) resolve pelo NOME do sistema (superlogica_nome/id/aliases) normalizado — ex.: "Residencial Park" -> park.json.
  //    Só match EXATO normalizado (sem substring, p/ não colidir "Cedros" x "Cedros do Campo").
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    let d; try { d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")); } catch { continue; }
    const chaves = [d.superlogica_nome, d.id, ...(Array.isArray(d.aliases) ? d.aliases : [])];
    if (chaves.some((k) => norm(k) === alvo)) return d;
  }
  throw new Error(`condomínio "${condId}" sem catálogo em dados/ (rode extrair-catalogo.mjs).`);
}

export function listarInfracoes(dados) {
  return Object.entries(dados.catalogo_infracoes).map(([id, v]) => ({
    id, titulo: v.titulo, fundamento: v.fundamento, palavras_chave: v.palavras_chave || [],
  }));
}

// "A" · "A e o B" · "A, o B e o C" — o "o" inicial já vem da frase ("Considerando o que dispõe o …").
function listar(xs) {
  if (xs.length <= 1) return xs[0] || "";
  return xs.slice(0, -1).join(", o ") + " e o " + xs[xs.length - 1];
}

export function montarDoc(dados, oc, cadastro) {
  // cadastro do condomínio: vem do Superlógica (ao vivo) quando informado; senão o bloco fixo do catálogo (fallback/CLI).
  const cad = cadastro || dados.condominio;
  if (!cad || !cad.nome) throw new Error("cadastro do condomínio ausente (Superlógica não resolveu e não há bloco fixo no catálogo).");
  // infracao_id aceita um id OU uma lista (pedido do síndico do Garden Place 14/07: as 2 infrações
  // na MESMA notificação; antes o robô obrigava a equipe a escolher uma e a outra ficava de fora).
  // String continua funcionando — CLI e chamadores antigos não mudam.
  const ids = [...new Set([].concat(oc.infracao_id ?? []).filter(Boolean))].slice(0, 3);
  if (!ids.length) throw new Error("infracao_id é obrigatório (um id do catálogo, ou uma lista).");
  const infras = ids.map((id) => {
    const i = dados.catalogo_infracoes[id];
    if (!i) {
      const e = new Error(`infração "${id}" não existe no catálogo de ${dados.id}.`);
      e.infracoes_disponiveis = Object.keys(dados.catalogo_infracoes);
      throw e;
    }
    return i;
  });
  if (!oc.destinatario?.nome || !oc.destinatario?.apartamento) throw new Error("destinatario.nome e destinatario.apartamento são obrigatórios.");
  if (!oc.relato) throw new Error("relato (parágrafo da ocorrência) é obrigatório.");
  if (!oc.data_documento) throw new Error("data_documento é obrigatória.");

  const g = (oc.destinatario.genero || "M").toUpperCase();
  const papelNome = (PAPEL[oc.destinatario.papel] || PAPEL.responsavel)[g] || "condômino(a)";
  const tratamento = g === "F" ? "À Sra." : "Ao Sr.";
  const saudacao = `${tratamento} ${oc.destinatario.nome}, ${papelNome} do apartamento ${oc.destinatario.apartamento},`;

  let titulo, penalidade_paragrafo = null, penalidade_marcas = null;
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
    // O valor da multa vem do NÍVEL de reincidência, não da infração — por isso o parágrafo é único
    // e no plural ("descumprimento das normas") mesmo com 2+ infrações. Reincidências diferentes por
    // infração = um documento por infração (o síndico decide; a minuta é editável).
    penalidade_marcas = [`${numFmt} (${ext}) ${plural}`, `mês de ${p.mes_boleto}`];
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
    // 1 infração: "dispõe o X," · 2+: "dispõem o X, o Y e o Z," (concordância determinística)
    fundamento: `Considerando o que ${infras.length > 1 ? "dispõem" : "dispõe"} o ${listar(infras.map((i) => i.fundamento))},`,
    texto_artigo: infras[0].texto_artigo, // compat: quem lê o campo antigo continua vendo o 1º
    textos_artigo: infras.map((i) => i.texto_artigo),
    relato: oc.relato,
    penalidade_paragrafo,
    // Negrito determinístico das partes ESTRUTURAIS (não passa pelo LLM).
    saudacao_marcas: [oc.destinatario.nome, `apartamento ${oc.destinatario.apartamento}`],
    fundamento_marcas: infras.map((i) => i.fundamento),
    penalidade_marcas: penalidade_marcas,
    // Destaques do relato: o LLM só indica TRECHOS do próprio relato — nunca escreve marcação.
    // Cada um tem que ser substring exata do relato, senão é descartado (não altera o texto).
    relato_marcas: (Array.isArray(oc.destaques) ? oc.destaques : [])
      .filter((d) => typeof d === "string" && d.trim() && String(oc.relato).includes(d))
      .slice(0, 8),
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

/** gerarDocumento({ ocorrencia, destino?, raiz?, cadastro?, formato? }) -> { destino, titulo, formato }
 *  cadastro (do Superlógica) é opcional; sem ele, usa o bloco fixo do catálogo (CLI/fallback).
 *  formato: 'pdf' (default) ou 'word'/'doc' → .doc editável (equipe apara o excesso + edita o relato). */
export function gerarDocumento({ ocorrencia, destino, raiz = RAIZ, cadastro, formato }) {
  const dados = carregarCondominio(ocorrencia.condominio, raiz);
  const doc = montarDoc(dados, ocorrencia, cadastro);
  const html = renderHTML(doc);
  const word = /^(word|doc|docx)$/i.test(formato || "");
  if (!destino) {
    const ext = word ? "doc" : "pdf";
    const nome = `${slug(ocorrencia.condominio)}_${ocorrencia.tipo}_${slug([].concat(ocorrencia.infracao_id).join("-")).slice(0, 60)}_ap${slug(ocorrencia.destinatario.apartamento)}.${ext}`;
    destino = path.join(raiz, "saida", nome);
  }
  if (word) fs.writeFileSync(destino, htmlParaWord(html), "utf8");
  else htmlParaPdf(html, destino);
  return { destino, titulo: doc.titulo, formato: word ? "word" : "pdf" };
}
