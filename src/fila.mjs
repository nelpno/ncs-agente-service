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

// ---------------------------------------------------------------------------------------------------
// Decisão (b) — a fila só recebe HANDOFF ESTRUTURADO. `transferir_humano` é o escalonamento genérico;
// hoje ele criava linha p/ TODO handoff, inclusive o PURO ("quero um humano"). Isso pendura linha
// "Aberta" que nada fecha — a conversa do Chatwoot JÁ é o ticket daquele handoff (status/label/CSAT).
// Só ESTES tipos viram linha a partir de um handoff. Note o que fica FORA de propósito:
//  - família `cadastro` (cadastro_inquilino/dependente/cadastro): cadastro real entra pela
//    criar_rascunho_cadastro (com draft_id + card de Aprovações); um motivo `cadastro_*` num handoff é
//    falha de lookup, não pedido de cadastro → não vira ticket estruturado.
//  - `negociacao`/cobrança: frente própria, sem ação na fila ainda (incluir quando a F2 dela existir).
//  - boleto/cnd/clube/evento/prestador/portaria_acesso/outro: a Ana resolve, ou é "pessoa insiste" = puro.
const HANDOFF_ESTRUTURADO = new Set(['titularidade', 'mudanca', 'ocorrencia']);

/**
 * decidirHandoff(motivo, resumo, jaRegistrado) — decide se um `transferir_humano` vira linha na fila.
 * PURA (não checa a flag nem toca rede) → testável no gate. Classifica o `motivo` (enum deliberado da
 * tool, ex.: agendamento_mudanca→mudanca, reclamacao→ocorrencia) PRIMEIRO; se não for estruturado, dá
 * 2ª chance ao `resumo` (texto rico, ex.: "vazamento no teto"→ocorrencia). A família cadastro nunca
 * entra por aqui (ver acima). `jaRegistrado`=true (já carimbou um handoff nesta sessão) → não repete.
 * @returns {registrar:false} | {registrar:true, tipo, assunto} — assunto = resumo||motivo (item 6: enriquecido).
 */
export function decidirHandoff(motivo = '', resumo = '', jaRegistrado = false) {
  if (jaRegistrado) return { registrar: false, motivoSkip: 'ja_registrado_na_sessao' };
  const tm = classificar(motivo).tipo;
  let tipo = HANDOFF_ESTRUTURADO.has(tm) ? tm : null;
  if (!tipo) { const tr = classificar(resumo).tipo; if (HANDOFF_ESTRUTURADO.has(tr)) tipo = tr; }
  if (!tipo) return { registrar: false };
  return { registrar: true, tipo, assunto: resumo || motivo };
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

/**
 * marcarPorDraft(draftId, status, {por}, io?) — F2: fecha a(s) linha(s) vinculada(s) a um rascunho de
 * escrita-ERP. Chamado pelo engine ao APROVAR (status 'gravado') o cadastro → a linha da fila vira
 * 'resolvida' sozinha (o ticket fecha junto com a aprovação, sem 2º lugar pra fechar).
 * ⚠️ GUARDA CRITICA: sem `draftId` NÃO roda UPDATE — um WHERE vazio fecharia a fila INTEIRA.
 * Nunca lança (a fila não é caminho crítico do atendimento nem da aprovação).
 * @returns {ok:false,motivo} | {ok:true, atualizadas:<n>}
 */
export async function marcarPorDraft(draftId, status = 'resolvida', { por = null } = {}, io = {}) {
  // NÃO gated pela flag de propósito: FILA_ANA_ENABLED gateia a CRIAÇÃO da linha; FECHAR uma linha
  // existente é sempre seguro (casa 0 ou 1). Se a flag fosse revertida com linhas abertas, elas ainda
  // precisam fechar na aprovação (o Portal que lista nem conhece a flag da Ana).
  if (!draftId) return { ok: false, motivo: 'sem_draft' }; // guarda: sem draft NÃO roda UPDATE (fecharia a fila toda)
  const sbUpdate = io.sbUpdate || _sbUpdate;
  const patch = { status, resolvido_em: new Date().toISOString(), ...(por ? { resolvido_por: por } : {}) };
  try {
    const rows = await sbUpdate('solicitacoes', `draft_id=eq.${encodeURIComponent(draftId)}`, patch);
    const n = Array.isArray(rows) ? rows.length : 0;
    if (n === 0) console.warn('[fila] marcarPorDraft: nenhuma linha p/ draft', draftId, '(dessincronia fila×drafts, ou fila estava off na criação)');
    return { ok: true, atualizadas: n };
  } catch (e) {
    console.warn('[fila] marcarPorDraft falhou:', e.message);
    return { ok: false, motivo: 'erro', detalhe: e.message };
  }
}
