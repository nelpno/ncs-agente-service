// test_engine.mjs — fluxo do motor com ação fake (sem rede)
import path from 'node:path'; import os from 'node:os';
process.env.AUDIT_LOG_PATH = path.join(os.tmpdir(), `eng_${Date.now()}.jsonl`); // setar ANTES dos imports que carregam config
const { registerAction } = await import('../src/write/registry.mjs');
const { criarRascunho, aprovarRascunho, rejeitarRascunho } = await import('../src/write/engine.mjs');
const { lerEventos } = await import('../src/write/auditoria.mjs');
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

let gravou = 0;
registerAction({
  id: 'fake', timeAprovador: 'Recepção',
  validar: (d) => ({ ok: !!d.nome, erros: d.nome ? [] : ['faltou nome'] }),
  checarConflito: async () => ({ conflito: false, candidatos: [] }),
  snapshot: async () => ([]),
  montarPayload: (d) => ({ nome: d.nome }),
  gravar: async () => { gravou++; return { ok: true, dryRun: true }; },
  render: () => ({ campos: [], diff: [] }),
});

const inval = await criarRascunho('fake', {}, {});
ok(inval.ok === false, 'rascunho inválido barrado antes de persistir');

const cr = await criarRascunho('fake', { nome: 'Z' }, { solicitante: { nome: 'Sol' } });
ok(cr.ok && cr.token && cr.urlAprovacao.includes('/aprovacao/'), 'cria rascunho + url de aprovação');

const ap = await aprovarRascunho(cr.token, { aprovador: 'maria' });
ok(ap.ok && ap.gravado && gravou === 1, 'aprovar grava 1x');
const ap2 = await aprovarRascunho(cr.token, { aprovador: 'maria' });
ok(ap2.jaGravado === true && gravou === 1, 'idempotente: 2ª aprovação não regrava');

const evs = await lerEventos({ draftId: cr.draftId });
ok(evs.some((e) => e.tipo === 'criado') && evs.some((e) => e.tipo === 'gravado'), 'auditou criado + gravado');

const cr2 = await criarRascunho('fake', { nome: 'Y' }, {});
const rj = await rejeitarRascunho(cr2.token, { aprovador: 'joao', motivo: 'sem vínculo' });
ok(rj.ok && (await lerEventos({ draftId: cr2.draftId })).some((e) => e.tipo === 'rejeitado'), 'rejeitar audita');

ok((await aprovarRascunho('inexistente', {})).ok === false, 'token inválido não grava');
console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
