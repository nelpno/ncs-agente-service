// test_rota_aprovar.mjs — handlers de /write/aprovar e /write/rejeitar (Onda 1 §4.4).
// Testa o HANDLER puro exportado por server.mjs, SEM importar src/write/engine.mjs de verdade
// (a função aprovarRascunhoPorId é injetada como mock) e SEM subir o servidor HTTP nem o outbox
// worker — server.mjs tem guard de entrypoint (import.meta.url !== process.argv[1] neste teste).
import { criarHandlerAprovar, criarHandlerRejeitar } from '../server.mjs';

let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

// ── /write/aprovar ──────────────────────────────────────────────────────────────────────────────

{
  const chamadas = [];
  const mockAprovar = async (draftId, opts) => { chamadas.push({ draftId, opts }); return { ok: true, gravado: true, dryRun: true }; };
  const handler = criarHandlerAprovar({ aprovarRascunhoPorId: mockAprovar });

  const r1 = await handler({ draft_id: 'abc123', aprovador: 'maria' });
  ok(r1.status === 200 && r1.json.ok === true, 'aprovar OK: status 200 + ok:true');
  ok(r1.json.gravado === true && r1.json.dryRun === true, 'aprovar OK: repassa gravado/dryRun do engine');
  ok(chamadas.length === 1 && chamadas[0].draftId === 'abc123', 'encaminha draft_id certo pro engine');
  ok(chamadas[0].opts.aprovador === 'maria', 'encaminha aprovador certo pro engine');
}

{
  // correcoes deve ser repassado junto
  const chamadas = [];
  const mockAprovar = async (draftId, opts) => { chamadas.push({ draftId, opts }); return { ok: true, gravado: true, dryRun: false }; };
  const handler = criarHandlerAprovar({ aprovarRascunhoPorId: mockAprovar });
  await handler({ draft_id: 'd2', aprovador: 'joao', correcoes: { nome: 'Corrigido' } });
  ok(chamadas[0].opts.correcoes?.nome === 'Corrigido', 'encaminha correcoes pro engine');
}

{
  const handler = criarHandlerAprovar({ aprovarRascunhoPorId: async () => ({ ok: true, gravado: true, dryRun: true }) });
  const semId = await handler({ aprovador: 'maria' });
  ok(semId.status === 400 && semId.json.ok === false, 'sem draft_id -> 400');
  const semAprovador = await handler({ draft_id: 'x' });
  ok(semAprovador.status === 400 && semAprovador.json.ok === false, 'sem aprovador -> 400');
}

{
  const handler = criarHandlerAprovar({ aprovarRascunhoPorId: async () => ({ ok: false, motivo: 'nao_encontrado' }) });
  const r = await handler({ draft_id: 'inexistente', aprovador: 'maria' });
  ok(r.status === 404 && r.json.ok === false && r.json.motivo === 'nao_encontrado', 'draft inexistente -> 404');
}

{
  const handler = criarHandlerAprovar({ aprovarRascunhoPorId: async () => ({ ok: false, motivo: 'expirado' }) });
  const r = await handler({ draft_id: 'x', aprovador: 'maria' });
  ok(r.status === 409, 'draft expirado -> 409');
}

{
  const handler = criarHandlerAprovar({ aprovarRascunhoPorId: async () => ({ ok: false, motivo: 'invalido', erros: ['faltou nome'] }) });
  const r = await handler({ draft_id: 'x', aprovador: 'maria' });
  ok(r.status === 422 && Array.isArray(r.json.erros), 'dados inválidos -> 422 com erros[]');
}

{
  const handler = criarHandlerAprovar({ aprovarRascunhoPorId: async () => ({ ok: false, motivo: 'erro_gravacao', detalhe: 'timeout Superlógica' }) });
  const r = await handler({ draft_id: 'x', aprovador: 'maria' });
  ok(r.status === 502, 'erro na gravação (Superlógica) -> 502');
}

{
  const handler = criarHandlerAprovar({ aprovarRascunhoPorId: async () => { throw new Error('boom'); } });
  const r = await handler({ draft_id: 'x', aprovador: 'maria' });
  ok(r.status === 500 && r.json.motivo === 'erro_interno', 'exceção do engine -> 500 sem derrubar o handler');
}

{
  // engine ainda não tem aprovarRascunhoPorId (outro subagente pode não ter terminado) -> 501 explícito, não crash
  const handler = criarHandlerAprovar({});
  const r = await handler({ draft_id: 'x', aprovador: 'maria' });
  ok(r.status === 501 && r.json.motivo === 'aprovarRascunhoPorId_indisponivel', 'dependência ausente -> 501 (não quebra)');
}

{
  // idempotência: 2ª aprovação do mesmo draft já gravado
  const handler = criarHandlerAprovar({ aprovarRascunhoPorId: async () => ({ ok: true, jaGravado: true, draft: {} }) });
  const r = await handler({ draft_id: 'x', aprovador: 'maria' });
  ok(r.status === 200 && r.json.jaGravado === true, '2ª aprovação (já gravado) -> 200 idempotente, jaGravado:true');
}

// ── /write/rejeitar ─────────────────────────────────────────────────────────────────────────────

{
  const chamadas = [];
  const mockPorId = async (draftId, opts) => { chamadas.push({ draftId, opts }); return { ok: true, rejeitado: true }; };
  const handler = criarHandlerRejeitar({ rejeitarRascunhoPorId: mockPorId });
  const r = await handler({ draft_id: 'abc', aprovador: 'maria', motivo: 'sem vínculo' });
  ok(r.status === 200 && r.json.ok === true && r.json.rejeitado === true, 'rejeitar por draft_id (quando disponível) -> 200');
  ok(chamadas[0].draftId === 'abc' && chamadas[0].opts.motivo === 'sem vínculo', 'encaminha draft_id/motivo certos');
}

{
  // fallback: só existe rejeitarRascunho por token (situação real hoje do engine.mjs)
  const chamadas = [];
  const mockPorToken = async (token, opts) => { chamadas.push({ token, opts }); return { ok: true, rejeitado: true }; };
  const handler = criarHandlerRejeitar({ rejeitarRascunho: mockPorToken });
  const r = await handler({ token: 'tok123', aprovador: 'joao', motivo: 'duplicado' });
  ok(r.status === 200 && r.json.ok === true, 'rejeitar por token (fallback) -> 200');
  ok(chamadas[0].token === 'tok123', 'encaminha token certo pro engine');
}

{
  // pedem rejeitar por draft_id mas o engine só tem a variante por token -> pendência sinalizada, não inventa
  const handler = criarHandlerRejeitar({ rejeitarRascunho: async () => ({ ok: true, rejeitado: true }) });
  const r = await handler({ draft_id: 'abc', aprovador: 'maria' });
  ok(r.status === 501 && r.json.motivo === 'rejeitarRascunhoPorId_indisponivel', 'só draft_id + só variante por token -> 501 documentado (não chama por engano)');
}

{
  const handler = criarHandlerRejeitar({ rejeitarRascunho: async () => ({ ok: true, rejeitado: true }) });
  const semAprovador = await handler({ token: 't', motivo: 'x' });
  ok(semAprovador.status === 400, 'sem aprovador -> 400');
  const semNada = await handler({ aprovador: 'maria' });
  ok(semNada.status === 400, 'sem draft_id nem token -> 400');
}

{
  const handler = criarHandlerRejeitar({ rejeitarRascunho: async () => ({ ok: false, motivo: 'ja_gravado' }) });
  const r = await handler({ token: 't', aprovador: 'maria' });
  ok(r.status === 409 && r.json.motivo === 'ja_gravado', 'rejeitar draft já gravado -> 409');
}

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
