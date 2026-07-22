// fila.mjs — F1 da saída do Octadesk: a Ana carimba o ticket DIRETO na fila `solicitacoes`
// (a NOSSA base), em vez de só mandar o link do formulário que cai no Octadesk. É o degrau que
// tira o Octa da origem; a F2 dá os botões (Resolver / Aprovar-e-gravar) sobre a MESMA tabela.
//
// PASSIVO e reversível: com FILA_ANA_ENABLED != 'true' NÃO grava nada (comportamento byte-idêntico
// ao de hoje). A Ana só carimba HANDOFF (ocorrência/mudança/escrita-ERP) — o que ela resolve sozinha
// (CND, 2ª via, clube, dúvida) NÃO vira ticket humano, então a fila não nasce inflada.
//
// Origem/status são NOSSOS: origem='ana', status='aberta' — nunca herdados do Octadesk (cujo status
// é ruído: 96% vêm "resolvido" por auto-resolve). É o que conserta o "já chegou resolvido".
//
// ⚠️ LGPD: o assunto é texto livre (o motivo de um handoff pode carregar CPF/telefone) → sanitizarAssunto
// mascara antes de gravar. Nome do solicitante é permitido (igual ao espelho); CPF/telefone/e-mail não.
import { classificar, setorDoTipo } from './espelho.mjs';
import { sbInsert as _sbInsert, sbUpdate as _sbUpdate } from './db_ncs.mjs';

const habilitado = () => process.env.FILA_ANA_ENABLED === 'true';

// Mascara PII em texto livre: e-mail e sequências longas de dígitos (CPF/telefone). PRESERVA número
// de unidade (≤4 dígitos, ex. "0101") — não é PII e ajuda a identificar o ticket na fila.
export function sanitizarAssunto(s = '') {
  return String(s || '')
    .replace(/[\w.+-]+@[\w.-]+\.\w+/g, '[email]')
    .replace(/\d[\d.\-]{3,}\d/g, '[num]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/**
 * registrarSolicitacao({tipo?, assunto, requester?, canal?, draftId?}, io?) — insere um ticket da Ana.
 * @param io injetável ({sbInsert, sbUpdate}) para teste sem rede.
 * @returns {ok:false, motivo:'desligado'} com a flag off (nunca lança — a fila não é caminho crítico);
 *          {ok:true, protocolo:'NCS-A-<numero>', row} com a flag on.
 * tipo: quando conhecido (escrita-ERP) é respeitado; senão classifica pelo assunto (mesma triagem do espelho).
 * protocolo_ncs é gravado num 2º passo, pois o <numero> (identity) só existe após o insert.
 */
export async function registrarSolicitacao(
  { tipo, assunto = '', requester = null, canal = 'whatsapp', draftId = null } = {},
  io = {},
) {
  if (!habilitado()) return { ok: false, motivo: 'desligado' };
  const sbInsert = io.sbInsert || _sbInsert;
  const sbUpdate = io.sbUpdate || _sbUpdate;

  const assuntoSan = sanitizarAssunto(assunto);
  const tri = classificar(assuntoSan);
  const linha = {
    origem: 'ana',
    canal,
    tipo: tipo || tri.tipo,
    setor: tipo ? setorDoTipo(tipo) : tri.setor,
    assunto: assuntoSan || null,
    requester: requester || null,
    status: 'aberta',
    draft_id: draftId || null,
  };

  const row = await sbInsert('solicitacoes', linha);
  const numero = row?.numero ?? row?.id;
  const protocolo = `NCS-A-${numero}`;
  // 2º passo: grava o protocolo agora que temos o numero. WHERE por id desta linha = zero corrida.
  // Se falhar, a linha já existe (status aberta) — degrada (protocolo vazio), não perde o ticket.
  try {
    await sbUpdate('solicitacoes', `id=eq.${encodeURIComponent(row.id)}`, { protocolo_ncs: protocolo });
  } catch (e) {
    console.warn('[fila] protocolo_ncs nao gravado:', e.message);
  }
  return { ok: true, protocolo, row: { ...row, protocolo_ncs: protocolo } };
}
