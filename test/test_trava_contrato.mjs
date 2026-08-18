// test_trava_contrato.mjs — "sem contrato não efetiva" (decisão do Fernando, WhatsApp 17/08/2026).
//
// POR QUE ISTO EXISTE: ao autorizar ligar a gravação real do cadastro, ele condicionou —
// "Pode ligar (mas só efetivar se tiver contrato) / Sem contrato - não efetiva".
// Até aqui o card só AVISAVA (cadastro_inquilino.mjs: "não bloqueia o botão nem decide nada"),
// então ligar WRITE_REAL_ACTIONS sem esta trava entregaria o oposto do combinado.
//
// A trava mora no caminho da GRAVAÇÃO, nunca em validar(): validar() é chamado também na CRIAÇÃO
// do rascunho (engine.mjs:54), e travar ali faria o card não nascer — a equipe nem saberia que a
// pessoa pediu, que é pior que o problema.
//
// O QUE NÃO PODE SER TRAVADO (o caso legítimo ao lado): DEPENDENTE não tem contrato de locação —
// é filho/cônjuge de quem já mora lá. O Fernando falou de cadastro de inquilino; travar dependente
// por falta de contrato quebraria um fluxo que ele mesmo chama de legítimo.
//
// PARTE B existe porque a PARTE A sozinha fica VERDE com a garantia derrubada: ela exercita a
// função pura, e quem precisa CHAMÁ-LA é o engine. Sem a parte B, remover a chamada do engine
// deixaria a suíte verde com cadastro sem contrato gravando no ERP.
//
// Uso: node test/test_trava_contrato.mjs

import path from 'node:path';
import os from 'node:os';
process.env.AUDIT_LOG_PATH = path.join(os.tmpdir(), `trava_${Date.now()}.jsonl`); // ANTES dos imports que carregam config

const { cadastroInquilino } = await import('../src/write/actions/cadastro_inquilino.mjs');
const { registerAction } = await import('../src/write/registry.mjs');
const { criarRascunho, aprovarRascunho } = await import('../src/write/engine.mjs');

let failures = 0;
function assert(condition, label) {
  if (condition) console.log('  OK  ', label);
  else { console.error('  FAIL', label); failures++; }
}

const base = {
  id_condominio: '176', id_unidade: '13661', unidade_label: 'TORRE 03 - BLOCO A / 004',
  nome: 'Ivan Gonçalves Rabatini', data_entrada: '12/08/2026',
  cpf: '52998224725', email: 'ivan@exemplo.com', telefone: '16997874645',
  docia_ativo: true,
};
const bloqueio = (d) => cadastroInquilino.bloqueiaGravacao?.(d) || null;

console.log('\n=== test_trava_contrato.mjs ===\n');
console.log('--- PARTE A: a regra (função pura) ---\n');

console.log('1. INQUILINO sem contrato nenhum: não efetiva');
{
  const b = bloqueio({ ...base, papel: 'inquilino', laudo: null, documento_recebido: false });
  assert(b && b.bloqueia === true, 'inquilino sem documento é bloqueado');
  assert(b && b.motivo === 'sem_contrato', 'motivo identifica a causa (sem_contrato)');
  assert(b && typeof b.mensagem === 'string' && b.mensagem.length > 10,
    'traz mensagem legível para a tela de quem aprova');
}

console.log('\n2. INQUILINO com contrato: efetiva');
{
  assert(bloqueio({ ...base, papel: 'inquilino', laudo: { ok: true }, documento_recebido: true }) === null,
    'contrato chegou E foi conferido pelo DocIA → passa');
  assert(bloqueio({ ...base, papel: 'inquilino', laudo: null, documento_recebido: true }) === null,
    'contrato CHEGOU mas a conferência não rodou → passa (é a conv 848: a equipe vê o documento)');
  assert(bloqueio({ ...base, papel: 'inquilino', laudo: { ok: true }, documento_recebido: false }) === null,
    'tem laudo do DocIA → passa mesmo sem a marca de recebimento (rascunho antigo)');
}

console.log('\n3. DEPENDENTE nunca é travado por contrato (o caso legítimo ao lado)');
{
  assert(bloqueio({ ...base, papel: 'dependente', laudo: null, documento_recebido: false }) === null,
    'dependente sem contrato → passa (não existe contrato de locação de dependente)');
  assert(bloqueio({ ...base, papel: 'dependente', laudo: null, documento_recebido: false, solicitante_nome: 'Fulano' }) === null,
    'dependente pedido por terceiro também passa (quem julga isso é o alerta, não a trava)');
}

console.log('\n4. DocIA desligado não pode travar tudo');
{
  assert(bloqueio({ ...base, papel: 'inquilino', docia_ativo: false, laudo: null, documento_recebido: false }) === null,
    'sem DocIA no ar não há como saber do contrato → não trava (senão falha fechado em todo cadastro)');
}

console.log('\n5. Rascunho antigo, criado antes deste campo existir');
{
  const b = bloqueio({ ...base, papel: 'inquilino', laudo: null });
  assert(b && b.bloqueia === true,
    'documento_recebido ausente conta como não recebido (o campo só nasceu em 10/08)');
}

console.log('\n--- PARTE B: o engine OBEDECE a trava (senão a parte A fica verde à toa) ---\n');

let gravouTravada = 0;
registerAction({
  id: 'fake_travada', timeAprovador: 'Recepção',
  validar: () => ({ ok: true, erros: [] }),
  montarPayload: (d) => ({ nome: d.nome }),
  gravar: async () => { gravouTravada++; return { ok: true, dryRun: true }; },
  bloqueiaGravacao: (d) => (d.temContrato ? null : { bloqueia: true, motivo: 'sem_contrato', mensagem: 'faltou o contrato' }),
  render: () => ({ campos: [], diff: [] }),
});

{
  const cr = await criarRascunho('fake_travada', { nome: 'Sem Contrato', temContrato: false }, {});
  assert(cr.ok === true, 'o card NASCE mesmo sem contrato (a equipe tem de ver que a pessoa pediu)');
  const ap = await aprovarRascunho(cr.token, { aprovador: 'maria' });
  assert(ap.ok === false && ap.motivo === 'bloqueado', 'aprovar SEM contrato é recusado pelo engine');
  assert(gravouTravada === 0, 'e nada foi gravado no ERP');
  assert(typeof ap.mensagem === 'string' && ap.mensagem.length > 5, 'a recusa explica o porquê a quem aprova');
}

{
  const cr = await criarRascunho('fake_travada', { nome: 'Com Contrato', temContrato: true }, {});
  const ap = await aprovarRascunho(cr.token, { aprovador: 'maria' });
  assert(ap.ok === true && ap.gravado === true, 'CONTROLE: com contrato, o mesmo caminho grava normalmente');
  assert(gravouTravada === 1, 'gravou exatamente 1 vez');
}

// Guard que chama código de terceiro não pode derrubar a operação que protege (lição de 09/08:
// um guard que chamava função que lança causou 500 ao salvar em todo escritório com cadastro incompleto).
let gravouExplosiva = 0;
registerAction({
  id: 'fake_explosiva', timeAprovador: 'Recepção',
  validar: () => ({ ok: true, erros: [] }),
  montarPayload: (d) => ({ nome: d.nome }),
  gravar: async () => { gravouExplosiva++; return { ok: true, dryRun: true }; },
  bloqueiaGravacao: () => { throw new Error('boom'); },
  render: () => ({ campos: [], diff: [] }),
});
{
  const cr = await criarRascunho('fake_explosiva', { nome: 'Boom' }, {});
  const ap = await aprovarRascunho(cr.token, { aprovador: 'maria' });
  assert(ap.ok === true && gravouExplosiva === 1,
    'trava que EXPLODE não derruba a aprovação (quem recusa cadastro incompleto é o validar)');
}

// Ação sem trava nenhuma segue idêntica ao que era antes desta mudança.
let gravouSemTrava = 0;
registerAction({
  id: 'fake_sem_trava', timeAprovador: 'Recepção',
  validar: () => ({ ok: true, erros: [] }),
  montarPayload: (d) => ({ nome: d.nome }),
  gravar: async () => { gravouSemTrava++; return { ok: true, dryRun: true }; },
  render: () => ({ campos: [], diff: [] }),
});
{
  const cr = await criarRascunho('fake_sem_trava', { nome: 'Livre' }, {});
  const ap = await aprovarRascunho(cr.token, { aprovador: 'maria' });
  assert(ap.ok === true && gravouSemTrava === 1, 'CONTROLE: ação sem bloqueiaGravacao grava como antes');
}

console.log('\n--- PARTE C: a recusa CHEGA à tela de quem aprova ---\n');

// Sem isto, a trava funciona e a pessoa vê "sem_contrato" (jargão) ou um 400 genérico: um erro sem
// saída, na tela em que a equipe de fato trabalha. Consertar metade do par troca um sintoma por outro.
{
  const { criarHandlerAprovar } = await import('../server.mjs');
  const handler = criarHandlerAprovar({
    aprovarRascunhoPorId: async () => ({
      ok: false, motivo: 'bloqueado', detalhe: 'sem_contrato',
      mensagem: 'Sem contrato de locação não é possível concluir este cadastro.',
    }),
  });
  const r = await handler({ draft_id: 'x', aprovador: 'maria' });
  assert(r.status === 422, 'recusa por trava responde 422 (não o 400 genérico)');
  assert(r.json.ok === false && r.json.gravado === false, 'a tela sabe que NÃO gravou');
  assert(typeof r.json.mensagem === 'string' && r.json.mensagem.includes('contrato'),
    'a frase legível chega à tela (não só o código "sem_contrato")');
}

console.log(`\n${failures === 0 ? '✅ APROVADO' : `🔴 ${failures} FALHA(S)`} — test_trava_contrato.mjs\n`);
process.exitCode = failures === 0 ? 0 : 1;
