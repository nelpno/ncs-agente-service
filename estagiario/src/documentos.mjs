// documentos.mjs — ponte entre o Chat NCS e o MOTOR + Superlógica.
// Cadastro do condomínio e morador vêm AO VIVO do Superlógica; artigo/convenção/síndico do catálogo.
// As tools aqui NÃO têm IA — é o "data-gated" da arquitetura (o conteúdo vem da fonte, não do modelo).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  gerarDocumento, carregarCondominio, carregarCatalogo, listarInfracoes,
} from "../../gerador/src/gerar-lib.mjs";
import { gerarDeclaracaoQuitacao } from "../../gerador/src/declaracao-quitacao.mjs";
import { resolver_condominio, resolver_morador, resolver_sindico } from "./superlogica.mjs";
import { verificarEnquadramento, enquadramentoIncompativel } from "./verificar_enquadramento.mjs";
import { buscarArtigoCC } from "../../src/codigo_civil.mjs"; // Pesquisa 2: fallback no Código Civil quando o RI não cobre

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SAIDA = path.join(__dirname, "..", "saida");

function slugId(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}
function nomeSL(dados, fallback) {
  return dados.superlogica_nome || dados.condominio?.nome || fallback;
}

/** Cardápio fechado de infrações do condomínio (o LLM escolhe daqui). */
export function listar_infracoes({ condominio } = {}) {
  try {
    const d = carregarCondominio(condominio);
    return { ok: true, condominio: nomeSL(d, condominio), infracoes: listarInfracoes(d) };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

/** Busca o morador (nome + papel) por unidade, AO VIVO no Superlógica. */
export async function buscar_morador({ condominio, unidade, bloco } = {}) {
  try {
    const d = carregarCondominio(condominio);
    const cond = await resolver_condominio({ nome: nomeSL(d, condominio) });
    if (!cond.encontrado) return { encontrado: false, motivo: `condomínio não localizado no Superlógica (${cond.motivo || ""})` };
    return await resolver_morador({ id_condominio: cond.id, unidade, bloco });
  } catch (e) { return { encontrado: false, erro: e.message }; }
}

/** Dados cadastrais do condomínio — AO VIVO do Superlógica: nome, endereço, CEP, cidade, CNPJ e o SÍNDICO
 *  atual (nome/cargo/e-mail). Serve o vídeo "achar nome do síndico, endereço e CNPJ do condomínio".
 *  Nunca inventa: campo vazio volta null. O síndico vem de sindicos/index (associação = "Presidente"). */
export async function dados_condominio({ condominio } = {}) {
  try {
    const cond = await resolver_condominio({ nome: condominio });
    if (!cond.encontrado) return { ok: false, motivo: cond.motivo, ...(cond.opcoes ? { opcoes: cond.opcoes } : {}) };
    const sind = await resolver_sindico(cond.id).catch(() => ({ encontrado: false }));
    return {
      ok: true, nome: cond.nome, endereco: cond.endereco, cep: cond.cep, cidade_uf: cond.cidade_uf, cnpj: cond.cnpj || null,
      sindico: sind.encontrado ? { nome: sind.nome, cargo: sind.cargo, email: sind.email, telefone: sind.telefone } : null,
    };
  } catch (e) { return { ok: false, motivo: e.message }; }
}

/**
 * sugerirCodigoCivil({ relato }, deps?) — Pesquisa 2: acha o artigo do Código Civil que GOVERNA a conduta
 * do relato e o confirma com o MESMO verificador de enquadramento (2º olho isolado). Devolve o texto
 * VERBATIM da base (nunca do LLM). encontrou:false = não há base no CC (→ humano).
 * Fail-CLOSED de propósito: esta rota não tem a rede do catálogo, então sem verificador (LLM) não geramos —
 * só confirma quando o veredito é um 'sim' confiante. deps.chat é injetável (teste).
 */
export async function sugerirCodigoCivil({ relato } = {}, deps = {}) {
  if (!relato) return { encontrou: false };
  const podeVerificar = deps.chat || (process.env.VERIFICADOR_ENQUADRAMENTO !== "off" && process.env.OPENROUTER_API_KEY);
  if (!podeVerificar) return { encontrou: false, motivo: "sem_verificador" };
  const cand = buscarArtigoCC({ tema: relato, k: 3 });
  if (!cand.encontrou) return { encontrou: false, motivo: "nada_no_codigo_civil" };
  for (const art of cand.artigos) {
    const v = await verificarEnquadramento({ relato, artigos: [art.texto] }, deps);
    if (v.cobre === "sim") return { encontrou: true, fundamento: art.fundamento, texto_artigo: art.texto, secao: art.secao };
  }
  return { encontrou: false, motivo: "codigo_civil_nao_cobre" };
}

// _gerar — grava o documento (Word editável por padrão; PDF só se pedirem). Resolve o cadastro do condomínio
// AO VIVO no Superlógica (fallback no bloco fixo do catálogo se a rede/token falhar). `extra` acresce campos
// ao retorno (ex.: base_legal). resolverCond é injetável (teste hermético, sem rede).
async function _gerar(ocorrencia, dados, resolverCond, extra = {}, deps = {}) {
  const formato = /^(pdf)$/i.test(ocorrencia.formato || "") ? "pdf" : "word";
  const word = formato === "word";
  let cadastro;
  try {
    const cond = await resolverCond({ nome: nomeSL(dados, ocorrencia.condominio) });
    if (cond.encontrado) {
      cadastro = { nome: cond.nome, endereco: cond.endereco, cep: cond.cep, cidade_uf: cond.cidade_uf, cidade_fecho: cond.cidade_fecho };
      // Condomínio SEM catálogo não tem o síndico gravado — busca ao vivo no ERP para o documento não
      // sair com a linha de assinatura vazia. Nunca é caminho crítico: falhou, a linha fica em branco
      // e o síndico assina à mão (é minuta).
      if (!dados.responsavel && !ocorrencia.assinatura) {
        try {
          const sind = await (deps.resolverSindico || resolver_sindico)(cond.id);
          if (sind?.encontrado && sind.nome) ocorrencia.assinatura = { nome: sind.nome, cargo: sind.cargo || "SÍNDICO" };
        } catch { /* segue sem assinatura preenchida */ }
      }
    }
  } catch { /* sem Superlógica → cai no fallback do catálogo, se houver */ }

  fs.mkdirSync(SAIDA, { recursive: true });
  const stamp = Date.now().toString(36);
  const ext = word ? "doc" : "pdf";
  const idPart = ocorrencia.base_legal === "codigo_civil" ? "cc" : ([].concat(ocorrencia.infracao_id ?? []).join("-") || "doc");
  const arquivo = `${slugId(ocorrencia.condominio)}_${slugId(ocorrencia.tipo)}_${slugId(idPart).slice(0, 60)}_${stamp}.${ext}`;
  const destino = path.join(SAIDA, arquivo);
  const { titulo, formato: fmt } = gerarDocumento({ ocorrencia, destino, cadastro, formato });
  return { ok: true, titulo, arquivo, url: `/doc/${arquivo}`, formato: fmt, cadastro_fonte: cadastro ? "superlogica" : "catalogo", ...extra };
}

/** Gera o documento: cadastro ao vivo do Superlógica + artigo do catálogo do condomínio OU do Código Civil.
 *  Base legal em 2 camadas (Pesquisa 2, Fernando 23/07): se o enquadramento do RI não governa a conduta,
 *  o verificador vira ROTEADOR — oferece gerar pelo Código Civil; a 2ª chamada com base_legal='codigo_civil'
 *  (após a equipe confirmar) gera a NOTIFICAÇÃO citando a lei. deps = seam de teste (chat/resolverCondominio). */
export async function gerar_documento(args = {}, deps = {}) {
  try {
    const ocorrencia = { ...args, marca_revisao: args.marca_revisao !== false };
    // Tolerante na rota do Código Civil (condomínio sem Regimento Interno não tem catálogo, mas a lei
    // vale igual) — a regra mora no gerador, aqui só reusamos.
    const dados = carregarCatalogo(ocorrencia);
    const resolverCond = deps.resolverCondominio || resolver_condominio;

    // === Pesquisa 2 — geração explícita pelo Código Civil (após a oferta ser confirmada pela equipe). ===
    // O texto do artigo vem VERBATIM da base; se o verificador não confirmar um artigo, não gera (humano).
    if (ocorrencia.base_legal === "codigo_civil") {
      const sug = await sugerirCodigoCivil({ relato: ocorrencia.relato }, deps);
      if (!sug.encontrou) {
        return { ok: false, motivo: "sem_base_legal", detalhe: "Não localizei um artigo do Código Civil que trate especificamente dessa conduta — encaminhe ao jurídico/síndico." };
      }
      ocorrencia.tipo = "notificacao"; // o CC não fixa multa → documento sai como notificação
      ocorrencia.artigo_cc = { fundamento: sug.fundamento, texto_artigo: sug.texto_artigo };
      delete ocorrencia.infracao_id;
      return await _gerar(ocorrencia, dados, resolverCond, { base_legal: "codigo_civil", fundamento: sug.fundamento }, deps);
    }

    // === Catálogo do condomínio (padrão) — GUARD de enquadramento (peso jurídico): 2º olho ISOLADO confere
    // se o(s) artigo(s) escolhido(s) governam a conduta do relato — barra "capítulo errado" (ex.: infiltração
    // citando ruído de obra, incidente Allure 23/07). Roda com verificador (chave LLM ou chat injetado); é
    // fail-open (erro/ilegível NÃO barra). Desligável por VERIFICADOR_ENQUADRAMENTO=off. ===
    if (process.env.VERIFICADOR_ENQUADRAMENTO !== "off" && (deps.chat || process.env.OPENROUTER_API_KEY) && ocorrencia.relato) {
      const ids = [...new Set([].concat(ocorrencia.infracao_id ?? []).filter(Boolean))];
      const artigos = ids.map((id) => dados.catalogo_infracoes?.[id]?.texto_artigo).filter(Boolean);
      if (artigos.length) {
        const veredito = await verificarEnquadramento({ relato: ocorrencia.relato, artigos }, deps);
        if (enquadramentoIncompativel(veredito)) {
          const fund = ids.map((id) => dados.catalogo_infracoes?.[id]?.fundamento).filter(Boolean).join("; ");
          console.warn(`[enquadramento] BLOQUEADO ${ocorrencia.condominio} ids=${ids.join(",")} cobre=${veredito.cobre}`);
          // Pesquisa 2: em vez de parar no humano, tenta o Código Civil e OFERECE gerar por ele.
          const sug = await sugerirCodigoCivil({ relato: ocorrencia.relato }, deps);
          if (sug.encontrou) {
            return {
              ok: false, motivo: "usar_codigo_civil", cobre: veredito.cobre, ri_fundamento: fund,
              codigo_civil: { fundamento: sug.fundamento, artigo: sug.texto_artigo },
              detalhe: `O regimento/convenção do condomínio não trata dessa conduta. Pela lei, ela se enquadra em ${sug.fundamento}. Quer que eu gere a NOTIFICAÇÃO com base no Código Civil? (minuta para o síndico revisar e assinar)`,
            };
          }
          return {
            ok: false, motivo: "sem_base_legal", cobre: veredito.cobre, ri_fundamento: fund,
            detalhe: `O artigo escolhido (${fund}) não trata da conduta do relato e não achei artigo do Código Civil que a cubra especificamente. Não gerei o documento — reveja o enquadramento ou encaminhe ao jurídico/síndico.`,
          };
        }
      }
    }

    return await _gerar(ocorrencia, dados, resolverCond, {}, deps);
  } catch (e) {
    return { ok: false, erro: e.message, infracoes_disponiveis: e.infracoes_disponiveis };
  }
}

/**
 * Gera a DECLARAÇÃO DE QUITAÇÃO (CND). Por padrão a via INFORMATIVA (sem assinatura).
 * Resolve condo→id e unidade→id_unidade no Superlógica; os GATES (inadimplente/jurídico/garantidora)
 * vivem no motor (gerarDeclaracaoQuitacao) — só gera p/ quem está 100% em dia. Copia o PDF p/ SAIDA e
 * devolve o link /doc (servido pelo server do Estagiário).
 */
export async function gerar_cnd({ condominio, unidade, bloco, tipo = "informativo" } = {}) {
  try {
    // CND não depende do catálogo (gerador/dados) — resolve o condo direto pelo nome no Superlógica,
    // assim funciona para TODOS os condomínios (não só os que têm catálogo de infrações).
    const cond = await resolver_condominio({ nome: condominio });
    if (!cond.encontrado) return { ok: false, motivo: "condominio_nao_encontrado", detalhe: cond.motivo, opcoes: cond.opcoes };
    const mor = await resolver_morador({ id_condominio: cond.id, unidade, bloco });
    if (!mor.encontrado) return { ok: false, motivo: "unidade_nao_encontrada", detalhe: mor.motivo, ...(mor.candidatos?.length ? { candidatos: mor.candidatos } : {}) };
    const id_unidade = mor.moradores?.[0]?.id_unidade;
    if (!id_unidade) return { ok: false, motivo: "sem_id_unidade", detalhe: "não obtive o id da unidade no Superlógica" };
    // Passa o nº real do apartamento (st_unidade_uni + bloco) que o resolver_morador já obteve —
    // backup de resiliência caso a resolução dentro do gerador falhe (evita imprimir o id interno).
    const identificacaoUnidade = mor.moradores?.[0]?.apartamento || null;
    const r = await gerarDeclaracaoQuitacao({ id_condominio: cond.id, id_unidade, identificacaoUnidade, tipo });
    if (!r.ok) return { ok: false, motivo: r.motivo, detalhe: r.detalhe, ...(r.qtd_cobrancas_em_aberto != null ? { qtd_cobrancas_em_aberto: r.qtd_cobrancas_em_aberto } : {}) };
    fs.mkdirSync(SAIDA, { recursive: true });
    const arquivo = path.basename(r.destino);
    fs.copyFileSync(r.destino, path.join(SAIDA, arquivo));
    return { ok: true, titulo: `Declaração de Quitação (${tipo}) — unidade ${unidade}`, arquivo, url: `/doc/${arquivo}`, condominio: r.dados?.condominio?.nome || cond.nome, morador: mor.moradores?.[0]?.nome || null, tipo };
  } catch (e) { return { ok: false, motivo: "erro", detalhe: e.message }; }
}
