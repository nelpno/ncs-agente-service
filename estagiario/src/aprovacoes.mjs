// aprovacoes.mjs — fila de aprovação humana no Portal (spec §4.4 do design da Onda 1).
// O Portal é só UI: LÊ `escrita_drafts` do Supabase (mesmo banco do Estagiário) e, quando a
// pessoa decide, chama o EXECUTOR ÚNICO (agente-service, POST /write/aprovar|rejeitar) por HTTP.
// NUNCA grava em `escrita_drafts` nem toca no Superlógica direto — evita duplicar a lógica de
// gravação/CAS/posGravar que já vive no agente-service (princípio "um único executor", §2.3).
import * as realDb from "./db.mjs";
import { mascararCpf } from "./registro.mjs";
// O Portal roda a MESMA imagem do agente-service (ncs-chat e ncs-agente compartilham
// ghcr.io/nelpno/ncs-agente-service) → dá p/ chamar a própria `acao.render()` em vez de
// reimplementar a regra aqui. Mantém a ação como fonte única (§2.3) e o alerta nunca fica velho:
// é recalculado a partir do `dados` do draft, inclusive depois de uma correção.
import "../../src/write/actions/cadastro_inquilino.mjs"; // side-effect: registerAction
import { getAction } from "../../src/write/registry.mjs";

const enc = encodeURIComponent;

// Gating puro (usado pelo server.mjs) — Onda 1 não tem RBAC, só o campo `pode_aprovar` (§4.4: "Sem RBAC, YAGNI").
export function podeVerAprovacoes(sess) {
  return !!sess?.podeAprovar;
}

// Máscara recursiva rasa: aplica mascararCpf em toda string dentro de objetos/arrays.
// `dados`/`conflito` do draft podem trazer o CPF em qualquer campo (contatos[].ST_CPF etc.) —
// a tela de aprovação nunca deve exibir o CPF cru (LGPD, pedido explícito da tarefa).
export function mascararObjeto(v) {
  if (v == null) return v;
  if (typeof v === "string") return mascararCpf(v);
  if (Array.isArray(v)) return v.map(mascararObjeto);
  if (typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = mascararObjeto(val);
    return out;
  }
  return v;
}

// `resumo` (frase de decisão) e `alertas` (o que o humano faz à mão junto com o OK) vêm da AÇÃO.
// Defensivo: ação desconhecida ou render que lança NÃO pode derrubar a fila inteira — o card
// aparece sem os extras e o aprovador ainda vê os dados.
function extrasDaAcao(draft) {
  const fallback = { resumo: null, alertas: [], titulo: draft.acao || "Pedido" };
  try {
    const acao = getAction(draft.acao);
    if (!acao) return fallback;
    const titulo = acao.titulo || draft.acao;
    if (!acao.render) return { ...fallback, titulo };
    const r = acao.render(draft.dados || {}, draft.snapshot || []) || {};
    return { resumo: r.resumo || null, alertas: Array.isArray(r.alertas) ? r.alertas : [], titulo };
  } catch {
    return fallback;
  }
}

// Monta o card exibido na tela — só os campos que a UI precisa, CPF sempre mascarado.
export function paraCard(draft) {
  const { resumo, alertas, titulo } = extrasDaAcao(draft);
  return {
    id: draft.id,
    acao: draft.acao,
    titulo,
    resumo: mascararObjeto(resumo),
    alertas: mascararObjeto(alertas),
    dados: mascararObjeto(draft.dados),
    conflito: mascararObjeto(draft.conflito || null),
    solicitante: draft.solicitante || null,
    time_aprovador: draft.time_aprovador || null,
    criado_em: draft.criado_em,
    expira_em: draft.expira_em || null,
  };
}

// Lista a fila (mais antiga primeiro — FIFO, mesma ordem do §9 "fila lista").
export async function listarPendentes(db = realDb) {
  const rows = await db.sbSelect("escrita_drafts", "status=eq.pendente&order=criado_em.asc&select=*");
  return rows.map(paraCard);
}

function agenteUrl() {
  return (process.env.NCS_AGENTE_URL || "http://ncs-agente:8080").replace(/\/+$/, "");
}

// Chama o executor único. fetchImpl injetável (teste sem rede real).
// ⚠️ A rota /write/aprovar do agente-service exige `x-webhook-secret` QUANDO o WEBHOOK_SECRET está
// setado lá (e está, em prod). Sem o header → 401 → o botão "Aprovar" falhava com "não foi possível
// concluir agora" (bug achado ao vivo em 15/07). Os dois containers precisam do MESMO segredo.
async function chamarExecutor(caminho, body, fetchImpl = fetch) {
  const segredo = process.env.WEBHOOK_SECRET || "";
  const r = await fetchImpl(`${agenteUrl()}${caminho}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(segredo ? { "x-webhook-secret": segredo } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Number(process.env.NCS_AGENTE_TIMEOUT_MS || 15000)),
  });
  let out = null;
  try { out = await r.json(); } catch { /* resposta sem corpo JSON — segue com out=null */ }
  if (!r.ok) throw new Error(`executor ${caminho} ${r.status}: ${out?.erro || out?.motivo || "falhou"}`);
  return out;
}

// aprovador = { user_id, nome, papel } — identidade de QUEM aprovou/rejeitou (auditoria, §4.4).
export async function aprovar({ draftId, aprovador, motivo }, fetchImpl = fetch) {
  return chamarExecutor("/write/aprovar", { draft_id: draftId, aprovador, motivo: motivo || null }, fetchImpl);
}
export async function rejeitar({ draftId, aprovador, motivo }, fetchImpl = fetch) {
  return chamarExecutor("/write/rejeitar", { draft_id: draftId, aprovador, motivo: motivo || null }, fetchImpl);
}
