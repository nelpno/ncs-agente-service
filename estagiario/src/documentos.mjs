// documentos.mjs — ponte entre o Chat NCS e o MOTOR + Superlógica.
// Cadastro do condomínio e morador vêm AO VIVO do Superlógica; artigo/convenção/síndico do catálogo.
// As tools aqui NÃO têm IA — é o "data-gated" da arquitetura (o conteúdo vem da fonte, não do modelo).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  gerarDocumento, carregarCondominio, listarInfracoes,
} from "../../gerador/src/gerar-lib.mjs";
import { resolver_condominio, resolver_morador } from "./superlogica.mjs";

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

/** Gera o PDF: cadastro ao vivo do Superlógica + artigo/convenção/síndico do catálogo. */
export async function gerar_documento(args = {}) {
  try {
    const ocorrencia = { ...args, marca_revisao: args.marca_revisao !== false };
    const dados = carregarCondominio(ocorrencia.condominio);
    let cadastro;
    try {
      const cond = await resolver_condominio({ nome: nomeSL(dados, ocorrencia.condominio) });
      if (cond.encontrado) cadastro = { nome: cond.nome, endereco: cond.endereco, cep: cond.cep, cidade_uf: cond.cidade_uf, cidade_fecho: cond.cidade_fecho };
    } catch { /* sem Superlógica → cai no fallback do catálogo, se houver */ }

    fs.mkdirSync(SAIDA, { recursive: true });
    const stamp = Date.now().toString(36);
    const arquivo = `${slugId(ocorrencia.condominio)}_${slugId(ocorrencia.tipo)}_${slugId(ocorrencia.infracao_id || "doc")}_${stamp}.pdf`;
    const destino = path.join(SAIDA, arquivo);
    const { titulo } = gerarDocumento({ ocorrencia, destino, cadastro });
    return { ok: true, titulo, arquivo, url: `/doc/${arquivo}`, cadastro_fonte: cadastro ? "superlogica" : "catalogo" };
  } catch (e) {
    return { ok: false, erro: e.message, infracoes_disponiveis: e.infracoes_disponiveis };
  }
}
