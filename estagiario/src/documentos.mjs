// documentos.mjs — ponte entre o Chat NCS e o MOTOR + Superlógica.
// Cadastro do condomínio e morador vêm AO VIVO do Superlógica; artigo/convenção/síndico do catálogo.
// As tools aqui NÃO têm IA — é o "data-gated" da arquitetura (o conteúdo vem da fonte, não do modelo).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  gerarDocumento, carregarCondominio, listarInfracoes,
} from "../../gerador/src/gerar-lib.mjs";
import { gerarDeclaracaoQuitacao } from "../../gerador/src/declaracao-quitacao.mjs";
import { resolver_condominio, resolver_morador, resolver_sindico } from "./superlogica.mjs";
import { verificarEnquadramento, enquadramentoIncompativel } from "./verificar_enquadramento.mjs";

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

/** Gera o PDF: cadastro ao vivo do Superlógica + artigo/convenção/síndico do catálogo. */
export async function gerar_documento(args = {}) {
  try {
    const ocorrencia = { ...args, marca_revisao: args.marca_revisao !== false };
    const dados = carregarCondominio(ocorrencia.condominio);
    // GUARD de enquadramento (peso jurídico): um 2º olho ISOLADO confere se o(s) artigo(s) escolhido(s)
    // governam a conduta do relato — barra "capítulo errado" (ex.: infiltração citando ruído de obra,
    // incidente Allure 23/07). Pula sem chave LLM (CI hermético) e é fail-open (erro/ilegível NÃO barra);
    // só bloqueia num veredito confiante de incompatibilidade. Desligável por VERIFICADOR_ENQUADRAMENTO=off.
    if (process.env.VERIFICADOR_ENQUADRAMENTO !== "off" && process.env.OPENROUTER_API_KEY && ocorrencia.relato) {
      const ids = [...new Set([].concat(ocorrencia.infracao_id ?? []).filter(Boolean))];
      const artigos = ids.map((id) => dados.catalogo_infracoes?.[id]?.texto_artigo).filter(Boolean);
      if (artigos.length) {
        const veredito = await verificarEnquadramento({ relato: ocorrencia.relato, artigos });
        if (enquadramentoIncompativel(veredito)) {
          const fund = ids.map((id) => dados.catalogo_infracoes?.[id]?.fundamento).filter(Boolean).join("; ");
          console.warn(`[enquadramento] BLOQUEADO ${ocorrencia.condominio} ids=${ids.join(",")} cobre=${veredito.cobre}`);
          return {
            ok: false, motivo: "enquadramento_bloqueado", cobre: veredito.cobre,
            detalhe: `O artigo escolhido (${fund}) não trata da conduta descrita no relato. Não gerei o documento para não citar base legal errada — ofereça consultar_regimento para o artigo correto ou reveja o enquadramento.`,
          };
        }
      }
    }
    // Advertência/multa: Word EDITÁVEL por padrão (pedido do Fernando 08/07) — a equipe apaga os
    // artigos que não se aplicam e acrescenta o relato do síndico antes de finalizar. PDF só se pedirem.
    const formato = /^(pdf)$/i.test(args.formato || "") ? "pdf" : "word";
    const word = formato === "word";
    let cadastro;
    try {
      const cond = await resolver_condominio({ nome: nomeSL(dados, ocorrencia.condominio) });
      if (cond.encontrado) cadastro = { nome: cond.nome, endereco: cond.endereco, cep: cond.cep, cidade_uf: cond.cidade_uf, cidade_fecho: cond.cidade_fecho };
    } catch { /* sem Superlógica → cai no fallback do catálogo, se houver */ }

    fs.mkdirSync(SAIDA, { recursive: true });
    const stamp = Date.now().toString(36);
    const ext = word ? "doc" : "pdf";
    const arquivo = `${slugId(ocorrencia.condominio)}_${slugId(ocorrencia.tipo)}_${slugId([].concat(ocorrencia.infracao_id ?? []).join("-") || "doc").slice(0, 60)}_${stamp}.${ext}`;
    const destino = path.join(SAIDA, arquivo);
    const { titulo, formato: fmt } = gerarDocumento({ ocorrencia, destino, cadastro, formato });
    return { ok: true, titulo, arquivo, url: `/doc/${arquivo}`, formato: fmt, cadastro_fonte: cadastro ? "superlogica" : "catalogo" };
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
