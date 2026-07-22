// solicitacoes.mjs — fila espelhada dos tickets do Octadesk (tabela `solicitacoes`, espelho PASSIVO
// escrito por agente-service/src/espelho.mjs). Só LEITURA aqui: o Portal apenas mostra, quem grava é
// o worker do espelho. Clona o padrão de pendencias.mjs (mesmo par gate+listagem).
import * as realDb from "./db.mjs";

// Gate: além de owner/admin (igual pendências), funcionário também vê — é fila operacional de
// triagem (protocolo/tipo/setor/assunto/status), sem PII sensível (a linha nunca guarda telefone/
// CPF/e-mail — ver espelho.mjs), então faz sentido pra quem atende no dia a dia, não só gestão.
export function podeVerSolicitacoes(sess) {
  return !!(sess && ["owner", "admin", "funcionario"].includes(sess.papel));
}

// Campos estruturados que a tela usa — nunca `raw` (jsonb cru do ticket) nem `octadesk_id`.
// `origem` ('ana' | 'octadesk') distingue a linha própria da Ana (F1) da espelhada do Octa.
// F2: `id` (uuid, chave do botão Resolver) e `draft_id` (linha de escrita-ERP → link p/ Aprovações) —
// não são PII; só aparecem p/ staff autenticado (owner/admin/funcionário).
const SELECT = "id,protocolo_ncs,octadesk_number,origem,tipo,setor,assunto,status,requester,draft_id,resolvido_por,resolvido_em,criado_em,atualizado_em";

export async function listarSolicitacoes({ tipo, status } = {}, db = realDb) {
  let q = `select=${SELECT}&order=criado_em.desc&limit=200`;
  if (tipo) q += `&tipo=eq.${encodeURIComponent(tipo)}`;
  if (status) q += `&status=eq.${encodeURIComponent(status)}`;
  return db.sbSelect("solicitacoes", q);
}

/**
 * resolverSolicitacao(id, {por}, db) — F2: fecha manualmente uma linha (processo humano, ex.: ocorrência
 * já resolvida). Marca status='resolvida' + resolvido_por/em. ⚠️ GUARDA CRÍTICA: sem `id` NÃO roda UPDATE
 * — um WHERE vazio fecharia a fila INTEIRA. Escrita-ERP fecha sozinha na aprovação (engine → marcarPorDraft),
 * não por aqui. Identidade (`por`) vem SEMPRE da sessão no server, nunca do body.
 */
export async function resolverSolicitacao(id, { por = null } = {}, db = realDb) {
  if (!id) return { ok: false, motivo: "sem_id" };
  const patch = { status: "resolvida", resolvido_em: new Date().toISOString(), ...(por ? { resolvido_por: por } : {}) };
  // WHERE restrito de propósito:
  //  - `draft_id=is.null`: o Resolver manual só fecha linha human-process. Escrita-ERP (tem draft_id) fecha
  //    SÓ na aprovação (engine → marcarPorDraft) — resolver à mão esconderia da fila um cadastro pendente.
  //  - `origem=eq.ana`: nunca toca a espelhada do Octa (o worker do espelho reverteria o status e deixaria
  //    `resolvido_por` órfão numa linha "aberta" — dado mentiroso). Espelhada reflete o Octadesk, ponto.
  const rows = await db.sbUpdate("solicitacoes", `id=eq.${encodeURIComponent(id)}&draft_id=is.null&origem=eq.ana`, patch);
  const n = Array.isArray(rows) ? rows.length : 0;
  // 0 linhas = id inexistente / era escrita-ERP / era espelhada → NÃO é sucesso (a UI reabilita o botão).
  if (n === 0) return { ok: false, motivo: "nao_encontrada" };
  return { ok: true, atualizadas: n };
}
