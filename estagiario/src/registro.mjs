// registro.mjs — monta e grava 1 linha de `interacoes` por turno (auditoria + custo + demanda).
// Chamado no server.mjs ENVOLVENDO o handleTurn: grava SEMPRE (inclusive quando o turno falha).
import { sbInsert as _sbInsert } from "./db.mjs";
import { tagDeterministica, condominioDeArgs, tipoDoc } from "./tags.mjs";

export function montarInteracao({ sess, sessionId, userText, turno, tMs, erro }) {
  const usage = turno?.usage || {};
  const tools = turno?.toolsUsed || [];
  return {
    usuario_id: sess?.uid || null,
    session_id: sessionId || null,
    condominio: condominioDeArgs(tools),
    tag: erro ? null : tagDeterministica(tools), // null → classificador async (Chunk 6) / painel = "outro"
    pergunta: (userText || "").slice(0, 2000),
    resposta: (turno?.reply || "").slice(0, 500), // auditoria "o que a IA disse" (truncado)
    gerou_doc: !!turno?.doc,
    tipo_doc: tipoDoc(tools),
    modelo: usage.modelo || null,
    tokens_prompt: usage.prompt || 0,
    tokens_completion: usage.completion || 0,
    tokens_cached: usage.cached || 0,
    latencia_ms: tMs || 0,
    erro: !!erro,
  };
}

export async function gravarInteracao(row, db) {
  const insert = db?.sbInsert || _sbInsert;
  const rec = await insert("interacoes", row);
  return rec?.id || null;
}
