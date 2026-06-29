// engine.mjs — máquina genérica de escrita com aprovação. Agnóstica ao tipo de ação.
import { getAction } from './registry.mjs';
import { criarDraft, getDraftByToken, updateDraft } from './drafts.mjs';
import { registrarEvento } from './auditoria.mjs';
import { config } from '../config.mjs';

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

export async function aprovarRascunho(token, { aprovador, correcoes } = {}) {
  const draft = await getDraftByToken(token);
  if (!draft) return { ok: false, motivo: 'nao_encontrado' };
  if (draft.status === 'gravado') return { ok: true, jaGravado: true, draft };
  if (draft.status === 'rejeitado') return { ok: false, motivo: 'ja_rejeitado' };
  if (draft.expiraEm <= Date.now()) { await updateDraft(draft.id, { status: 'expirado' }); return { ok: false, motivo: 'expirado' }; }

  const acao = getAction(draft.acao);
  let dados = draft.dados;
  if (correcoes && Object.keys(correcoes).length) {
    dados = { ...dados, ...correcoes };
    await registrarEvento({ tipo: 'corrigido', draftId: draft.id, aprovador, diff: correcoes });
    await updateDraft(draft.id, { dados, expiraEm: Date.now() + config.approvalTtlH * 3600 * 1000 }); // corrigir reinicia SLA
  }
  const v = acao.validar(dados);
  if (!v.ok) return { ok: false, motivo: 'invalido', erros: v.erros };

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
  await notificarMorador(draft, `✅ Seu cadastro foi concluído${res.dryRun ? ' (simulação)' : ''}.`);
  return { ok: true, gravado: true, dryRun: res.dryRun, draft, res };
}

export async function rejeitarRascunho(token, { aprovador, motivo } = {}) {
  const draft = await getDraftByToken(token);
  if (!draft) return { ok: false, motivo: 'nao_encontrado' };
  if (draft.status === 'gravado') return { ok: false, motivo: 'ja_gravado' };
  await updateDraft(draft.id, { status: 'rejeitado' });
  await registrarEvento({ tipo: 'rejeitado', draftId: draft.id, aprovador, detalhe: motivo || '' });
  await notificarMorador(draft, 'Sua solicitação foi revisada pela equipe e precisa de um ajuste; já entramos em contato.');
  return { ok: true, rejeitado: true };
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
