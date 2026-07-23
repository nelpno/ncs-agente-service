// verificar_enquadramento.mjs — 2º olho ISOLADO contra "capítulo errado" em documento jurídico.
// O incidente (Allure 23/07): um pedido de INFILTRAÇÃO saiu citando o capítulo de RUÍDO DE OBRA,
// porque o modelo, sem opção certa no cardápio, forçou a mais próxima. Este verificador recebe SÓ
// {relato, artigos} — sem cardápio, sem saber que houve seleção — então não herda a pressão de
// "tenho que escolher algo". Ele só responde se o artigo governa a conduta do relato.
//
// Regra de bloqueio (enquadramentoIncompativel): barra apenas num veredito CONFIANTE de incompatibilidade
// (não/parcial). "sim", veredito ilegível ou erro de infra => NÃO barra (fail-open) — uma queda do
// verificador (LLM sem crédito/timeout) não pode travar a equipe; as camadas determinísticas (catálogo
// com o artigo certo + contrato de prompt) seguem valendo. Desligável por env VERIFICADOR_ENQUADRAMENTO.
import { chat } from "../../src/llm.mjs";

const ENUM = new Set(["sim", "parcial", "nao"]);

const SYS =
  "Você confere se um ARTIGO de regimento condominial GOVERNA especificamente a conduta descrita num " +
  "RELATO de ocorrência de condomínio. Recebe SÓ o relato e o(s) artigo(s) — não sabe de cardápio nem de " +
  "escolha anterior, e NÃO deve ser leniente. Responda SOMENTE um JSON: {\"cobre\":\"sim\"|\"parcial\"|\"nao\"}. " +
  "\"sim\" = o artigo trata exatamente da conduta/dano do relato; \"parcial\" = toca o tema mas não é o " +
  "enquadramento correto (outro aspecto/capítulo); \"nao\" = é outro assunto. Sem explicação, só o JSON.";

// Extrai {cobre} de forma tolerante (JSON puro, JSON no meio de texto, ou "cobre: valor"). Fora do enum => null.
export function parseVeredito(texto) {
  const m = String(texto || "").match(/["']?cobre["']?\s*[:=]\s*["']?(sim|parcial|n[aã]o)["']?/i);
  if (!m) return null;
  const v = m[1].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return ENUM.has(v) ? { cobre: v } : null;
}

// BLOQUEIA só num veredito confiante de incompatibilidade (nao/parcial). sim/null/erro => NÃO bloqueia.
export function enquadramentoIncompativel(veredito) {
  const c = veredito?.cobre;
  return c === "nao" || c === "parcial";
}

// verificarEnquadramento({relato, artigos}, deps?) → {cobre} | {cobre:null, erro}. deps.chat injetável (teste).
export async function verificarEnquadramento({ relato, artigos } = {}, deps = {}) {
  const _chat = deps.chat || chat;
  const arts = [].concat(artigos || []).filter(Boolean);
  if (!relato || !arts.length) return { cobre: null, erro: "faltam relato ou artigos" };
  try {
    const res = await _chat({
      messages: [
        { role: "system", content: SYS },
        { role: "user", content: JSON.stringify({ relato: String(relato), artigos: arts }) },
      ],
      maxTokens: 400, temperature: 0, // folga p/ o reasoning do gpt-5.x (senão o veredito vem truncado/vazio)
    });
    return parseVeredito(res?.content || "") || { cobre: null, erro: "veredito_ilegivel" };
  } catch (e) {
    return { cobre: null, erro: e?.message || String(e) };
  }
}
