// engine.mjs — máquina genérica de escrita com aprovação. Agnóstica ao tipo de ação.
import { getAction } from './registry.mjs';
import { criarDraft, getDraft, getDraftByToken, updateDraft, aprovarDraftCAS } from './drafts.mjs';
import { registrarEvento } from './auditoria.mjs';
import { config } from '../config.mjs';
import * as FILA from '../fila.mjs'; // F2: fecha a linha da fila (solicitacoes) vinculada ao rascunho ao aprovar

export async function criarRascunho(acaoId, dados, ctx = {}) {
  const acao = getAction(acaoId);
  if (!acao) return { ok: false, motivo: 'acao_desconhecida' };
  const v = acao.validar(dados);
  if (!v.ok) return { ok: false, motivo: 'invalido', erros: v.erros };
  const conflito = acao.checarConflito ? await acao.checarConflito(ctx, dados) : null;
  const snapshot = acao.snapshot ? await acao.snapshot(ctx, dados) : null;
  const draft = await criarDraft({
    acao: acaoId, dados, snapshot, conflito,
    solicitante: ctx.solicitante || null, time: acao.timeAprovador || 'Atendimento geral',
    origem: ctx.origem || null,
  });
  await registrarEvento({ tipo: 'criado', draftId: draft.id, acao: acaoId, solicitante: draft.solicitante, dados, conflito, snapshot });
  return {
    ok: true, draftId: draft.id, token: draft.token, time: draft.time, conflito,
    urlAprovacao: `${config.publicBase}/aprovacao/${draft.token}`,
  };
}

// F2: fecha a linha da fila (solicitacoes) vinculada a este draft, seja qual for o desfecho — gravado
// (resolvida), rejeitado (rejeitada) ou expirado (expirada). Senão a linha ficava "aberta" órfã (a
// rejeição é o "Devolver", fluxo NORMAL, não exceção). Defensivo: nunca derruba o fluxo do engine, e
// NÃO é gated pela flag (a flag gateia a CRIAÇÃO da linha; fechar linha existente é sempre seguro —
// casa 0 ou 1 linha — e o Portal que lista nem conhece a flag da Ana).
async function fecharFilaDoDraft(draftId, status, por) {
  try { await FILA.marcarPorDraft(draftId, status, { por: por || null }); }
  catch (e) { console.warn('[engine] marcarPorDraft (fila) falhou:', e.message); }
}

// Núcleo compartilhado por aprovarRascunho(token) e aprovarRascunhoPorId(id) — mesmo fluxo,
// só muda como o draft é resolvido. CAS (pendente->aprovando) ANTES de gravar no Superlógica:
// evita que 2 aprovadores concorrentes gravem 2x o mesmo rascunho.
async function executarAprovacao(draft, { aprovador, correcoes } = {}) {
  if (!draft) return { ok: false, motivo: 'nao_encontrado' };
  if (draft.status === 'gravado') return { ok: true, jaGravado: true, draft };
  if (draft.status === 'rejeitado') return { ok: false, motivo: 'ja_rejeitado' };
  if (draft.status === 'expirado') return { ok: false, motivo: 'expirado' };
  if (draft.expiraEm <= Date.now()) {
    await updateDraft(draft.id, { status: 'expirado' });
    await registrarEvento({ tipo: 'expirado', draftId: draft.id });
    await fecharFilaDoDraft(draft.id, 'expirada'); // fecha a linha da fila (sem aprovador — expirou sozinho)
    await notificarMorador(draft, 'Sua solicitação expirou sem aprovação; caso ainda precise, é só me chamar de novo.');
    return { ok: false, motivo: 'expirado' };
  }

  const acao = getAction(draft.acao);
  let dados = draft.dados;
  if (correcoes && Object.keys(correcoes).length) {
    dados = { ...dados, ...correcoes };
    await registrarEvento({ tipo: 'corrigido', draftId: draft.id, aprovador, diff: correcoes });
    await updateDraft(draft.id, { dados, expiraEm: Date.now() + config.approvalTtlH * 3600 * 1000 }); // corrigir reinicia SLA
  }
  const v = acao.validar(dados);
  if (!v.ok) return { ok: false, motivo: 'invalido', erros: v.erros };

  // Reivindica o draft atomicamente. Se perder (outro aprovador já pegou), não grava de novo.
  const claimed = await aprovarDraftCAS(draft.id, aprovador);
  if (!claimed) return { ok: false, motivo: 'ja_em_processamento' };

  // GUARDAR OS DADOS ANTES (lição do incidente 23/07): snapshot FRESCO do estado atual, gravado na
  // auditoria ANTES de qualquer escrita. É a rede que permite restaurar se a gravação corromper algo —
  // foi exatamente o que faltou (sem o snapshot do dono original, com CPF, não deu p/ desfazer no ERP).
  // Fresco porque o estado pode mudar entre o rascunho e a aprovação. Defensivo: nunca aborta a aprovação
  // por falha de leitura, mas loga alto — um write sem rede de segurança é evento de auditoria.
  let preSnapshot = draft.snapshot;
  try { if (acao.snapshot) preSnapshot = await acao.snapshot({}, dados); }
  catch (e) { console.warn('[engine] snapshot pré-gravação falhou (segue, mas sem rede de restauração):', e.message); }
  await registrarEvento({ tipo: 'pre_gravacao', draftId: draft.id, acao: draft.acao, snapshot: preSnapshot });

  const payload = acao.montarPayload(dados); // computa 1x; reusa no gravar e na auditoria
  let res;
  try { res = await acao.gravar(payload, { dados }); }
  catch (e) {
    await updateDraft(draft.id, { status: 'erro' });
    await registrarEvento({ tipo: 'erro', draftId: draft.id, aprovador, detalhe: e.message });
    return { ok: false, motivo: 'erro_gravacao', detalhe: e.message };
  }
  if (!res.ok) {
    await updateDraft(draft.id, { status: 'erro' });
    await registrarEvento({ tipo: 'erro', draftId: draft.id, aprovador, resposta: res.resposta, status: res.status });
    return { ok: false, motivo: 'erro_gravacao', resposta: res.resposta };
  }
  await updateDraft(draft.id, { status: 'gravado', resultado: { idCriado: res.idCriado, candidatosId: res.candidatosId, dryRun: res.dryRun } });
  await registrarEvento({ tipo: 'gravado', draftId: draft.id, aprovador, payload, resposta: res.resposta, idCriado: res.idCriado, candidatosId: res.candidatosId, dryRun: res.dryRun, snapshot: draft.snapshot });

  // F2: fecha a linha da fila (solicitacoes) vinculada a este rascunho — o ticket resolve JUNTO com a aprovação.
  await fecharFilaDoDraft(draft.id, 'resolvida', aprovador?.nome);

  // Conectores pós-gravação (ex.: avisar a portaria). Defensivo: nunca derruba a gravação já feita.
  let conectores = null;
  if (acao.posGravar) {
    try {
      conectores = await acao.posGravar(dados, { dryRun: res.dryRun });
      if (conectores) await registrarEvento({ tipo: 'conectores', draftId: draft.id, conectores });
    } catch (e) { console.warn('[engine] posGravar falhou:', e.message); }
  }

  await notificarMorador(draft, `✅ Seu cadastro foi concluído${res.dryRun ? ' (simulação)' : ''}.`);
  return { ok: true, gravado: true, dryRun: res.dryRun, draft, res, conectores };
}

export async function aprovarRascunho(token, { aprovador, correcoes } = {}) {
  const draft = await getDraftByToken(token);
  return executarAprovacao(draft, { aprovador, correcoes });
}

// Mesmo fluxo de aprovarRascunho, mas resolve o draft por ID (o executor HTTP interno
// recebe draft_id do Portal, não o token — token é só para o link público do morador/painel).
export async function aprovarRascunhoPorId(draftId, { aprovador, correcoes } = {}) {
  const draft = await getDraft(draftId);
  return executarAprovacao(draft, { aprovador, correcoes });
}

// Núcleo compartilhado por rejeitarRascunho(token) e rejeitarRascunhoPorId(id) — mesmo fluxo,
// só muda como o draft é resolvido (token = link público; id = executor HTTP interno/Portal).
async function executarRejeicao(draft, { aprovador, motivo } = {}) {
  if (!draft) return { ok: false, motivo: 'nao_encontrado' };
  if (draft.status === 'gravado') return { ok: false, motivo: 'ja_gravado' };
  await updateDraft(draft.id, { status: 'rejeitado' });
  await registrarEvento({ tipo: 'rejeitado', draftId: draft.id, aprovador, detalhe: motivo || '' });
  await fecharFilaDoDraft(draft.id, 'rejeitada', aprovador?.nome); // fecha a linha da fila (rejeição = "Devolver", fluxo normal)
  await notificarMorador(draft, 'Sua solicitação foi revisada pela equipe e precisa de um ajuste; já entramos em contato.');
  return { ok: true, rejeitado: true };
}

export async function rejeitarRascunho(token, { aprovador, motivo } = {}) {
  const draft = await getDraftByToken(token);
  return executarRejeicao(draft, { aprovador, motivo });
}

// Mesmo fluxo de rejeitarRascunho, mas resolve o draft por ID (o executor HTTP interno
// recebe draft_id do Portal, não o token).
export async function rejeitarRascunhoPorId(draftId, { aprovador, motivo } = {}) {
  const draft = await getDraft(draftId);
  return executarRejeicao(draft, { aprovador, motivo });
}

// Notifica o morador no canal de origem. Sem buraco: se não houver canal/URL, registra como pendente.
async function notificarMorador(draft, mensagem) {
  try {
    if (draft.origem?.adapterNotify && config.adapterNotifyUrl) {
      await fetch(config.adapterNotifyUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conv: draft.origem.conv, mensagem }), signal: AbortSignal.timeout(10000),
      });
      return;
    }
  } catch (e) { console.warn('[engine] notificarMorador falhou:', e.message); }
  await registrarEvento({ tipo: 'confirmacao_pendente', draftId: draft.id, mensagem });
}
