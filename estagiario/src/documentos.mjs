// documentos.mjs — ponte entre o Estagiário e o MOTOR determinístico (gerador-documentos).
// As tools aqui NÃO têm IA: lêem o catálogo e geram o PDF. É o "data-gated" da arquitetura —
// o artigo/valor vêm daqui (fonte), não do modelo.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  gerarDocumento, carregarCondominio, listarInfracoes,
} from "../../gerador/src/gerar-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SAIDA = path.join(__dirname, "..", "saida");

function slugId(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

/** Lista o cardápio fechado de infrações de um condomínio (o LLM escolhe daqui). */
export function listar_infracoes({ condominio } = {}) {
  try {
    const d = carregarCondominio(condominio);
    return { ok: true, condominio: d.condominio.nome, infracoes: listarInfracoes(d) };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

/** Gera o PDF da notificação/multa. Recebe a ocorrência já estruturada pelo LLM. */
export function gerar_documento(args = {}) {
  try {
    const ocorrencia = { ...args, marca_revisao: args.marca_revisao !== false };
    fs.mkdirSync(SAIDA, { recursive: true });
    const stamp = Date.now().toString(36);
    const arquivo = `${slugId(ocorrencia.condominio)}_${slugId(ocorrencia.tipo)}_${slugId(ocorrencia.infracao_id || "doc")}_${stamp}.pdf`;
    const destino = path.join(SAIDA, arquivo);
    const { titulo } = gerarDocumento({ ocorrencia, destino });
    return { ok: true, titulo, arquivo, url: `/doc/${arquivo}` };
  } catch (e) {
    return { ok: false, erro: e.message, infracoes_disponiveis: e.infracoes_disponiveis };
  }
}
