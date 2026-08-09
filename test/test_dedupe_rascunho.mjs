// test_dedupe_rascunho.mjs — uma conversa, um card por cadastro.
//
// O defeito medido em 08/08 (stress, cenário S12 rodada 2): a Ana criou o rascunho, seguiu
// conversando como se não tivesse criado, e criou outro — dois cards idênticos com 12 s de diferença.
// Na fila REAL de 07/08 a Maria Poliana tinha 2 rascunhos do mesmo cadastro. Com a gravação ligada,
// isso é a pessoa cadastrada duas vezes na unidade.
import assert from 'node:assert';
import { chaveDoCadastro, registrarRascunho, dedupeAtivo } from '../src/write/dedupe_rascunho.mjs';

let ok = 0;
// ⚠️ `await fn()` mesmo nos casos síncronos. Com o helper síncrono e um caso `async`, a asserção
// rejeita DEPOIS do `console.log('ok')` e depois do total — a tela mostrava "15 OK" com a garantia
// derrubada, e só o exit code contava a verdade. Foi assim que este arquivo quase virou o teste que
// fica verde com o defeito de volta em produção.
const t = async (nome, fn) => { try { await fn(); console.log(`  ok  ${nome}`); ok++; } catch (e) { console.error(`  FALHOU  ${nome}\n      ${e.message}`); process.exitCode = 1; } };

console.log('\n[1] a chave identifica O MESMO cadastro apesar de como a pessoa escreve');

await t('acento, caixa e espaço duplo dão a mesma chave', () => {
  const a = chaveDoCadastro({ id_unidade: '13072', nome: 'Fabrício  Nery Bandeira', papel: 'inquilino' });
  const b = chaveDoCadastro({ id_unidade: '13072', nome: 'FABRICIO NERY BANDEIRA', papel: 'inquilino' });
  assert.equal(a, b, 'a mesma pessoa gerou chaves diferentes — o dedupe não pegaria a duplicata');
});

await t('papel omitido vale como inquilino (é o default da tool)', () => {
  assert.equal(chaveDoCadastro({ id_unidade: '1', nome: 'X' }), chaveDoCadastro({ id_unidade: '1', nome: 'X', papel: 'inquilino' }));
});

console.log('\n[2] 🔴 CONTROLES: o que NÃO pode ser tratado como duplicata');

await t('pessoas diferentes na mesma unidade → chaves diferentes', () => {
  const a = chaveDoCadastro({ id_unidade: '13072', nome: 'Fabrício Nery Bandeira', papel: 'inquilino' });
  const b = chaveDoCadastro({ id_unidade: '13072', nome: 'Joana Pereira Lima', papel: 'inquilino' });
  assert.notEqual(a, b, 'dois moradores da mesma unidade colidiram — o 2º cadastro sumiria');
});

await t('a mesma pessoa em UNIDADES diferentes → chaves diferentes', () => {
  const a = chaveDoCadastro({ id_unidade: '13072', nome: 'Fabrício Nery Bandeira' });
  const b = chaveDoCadastro({ id_unidade: '13073', nome: 'Fabrício Nery Bandeira' });
  assert.notEqual(a, b, 'quem tem imóvel em dois prédios perderia um cadastro');
});

await t('inquilino e dependente com o mesmo nome → chaves diferentes', () => {
  const a = chaveDoCadastro({ id_unidade: '1', nome: 'Ana Souza', papel: 'inquilino' });
  const b = chaveDoCadastro({ id_unidade: '1', nome: 'Ana Souza', papel: 'dependente' });
  assert.notEqual(a, b, 'papel diferente é pedido diferente, não duplicata');
});

console.log('\n[3] o que registrar devolve');

await t('1º rascunho da conversa → nada a expirar', () => {
  const ctx = {};
  const r = registrarRascunho(ctx, { id_unidade: '13072', nome: 'Fabrício Nery Bandeira' }, 'draft-A');
  assert.equal(r.expirar, null);
  assert.equal(ctx.rascunhosCadastro[r.chave], 'draft-A', 'não guardou o id na sessão');
});

await t('2º rascunho do MESMO cadastro → manda expirar o 1º (o caso S12)', () => {
  const ctx = {};
  registrarRascunho(ctx, { id_unidade: '13072', nome: 'Fabrício Nery Bandeira' }, 'draft-A');
  const r = registrarRascunho(ctx, { id_unidade: '13072', nome: 'Fabrício  Nery Bandeira' }, 'draft-B');
  assert.equal(r.expirar, 'draft-A', 'o card antigo ficaria de pé junto com o novo');
  assert.equal(ctx.rascunhosCadastro[r.chave], 'draft-B', 'a sessão tem de apontar para o mais NOVO');
});

await t('🔑 SUBSTITUI, não bloqueia: o 2º card é o que vale (pode ser a correção de um dado)', () => {
  const ctx = {};
  registrarRascunho(ctx, { id_unidade: '161', nome: 'Thales Bragança Mota' }, 'draft-com-data-velha');
  const r = registrarRascunho(ctx, { id_unidade: '161', nome: 'Thales Bragança Mota' }, 'draft-com-data-nova');
  assert.equal(ctx.rascunhosCadastro[r.chave], 'draft-com-data-nova',
    'bloquear o 2º manteria a data ERRADA — a pessoa corrigiu depois de a Ana já ter preparado');
});

await t('cadastro de OUTRA pessoa na mesma conversa não expira o anterior', () => {
  const ctx = {};
  registrarRascunho(ctx, { id_unidade: '1', nome: 'Pai' }, 'draft-pai');
  const r = registrarRascunho(ctx, { id_unidade: '1', nome: 'Filha', papel: 'dependente' }, 'draft-filha');
  assert.equal(r.expirar, null, 'cadastrar dois moradores na mesma conversa apagaria o primeiro');
});

await t('registrar o MESMO id duas vezes não manda expirar a si mesmo', () => {
  const ctx = {};
  registrarRascunho(ctx, { id_unidade: '1', nome: 'X' }, 'draft-A');
  const r = registrarRascunho(ctx, { id_unidade: '1', nome: 'X' }, 'draft-A');
  assert.equal(r.expirar, null, 'um retry do chamador apagaria o card que acabou de nascer');
});

await t('sem sessão (canal sem memória) não quebra nem inventa expiração', () => {
  const r = registrarRascunho(null, { id_unidade: '1', nome: 'X' }, 'draft-A');
  assert.equal(r.expirar, null);
});

console.log('\n[4] kill-switch');

await t('ligado por padrão', () => {
  delete process.env.DEDUPE_RASCUNHO;
  assert.equal(dedupeAtivo(), true);
});

await t('DEDUPE_RASCUNHO=0 desliga (permite A/B honesto sem rebuild)', () => {
  process.env.DEDUPE_RASCUNHO = '0';
  assert.equal(dedupeAtivo(), false);
  delete process.env.DEDUPE_RASCUNHO;
});

console.log('\n[5] pino: a decisão pura não vale nada se ninguém a chamar');

// ⚠️ Pino de FONTE, no molde do test_sl_retry. Os testes acima provam a DECISÃO; este prova que o
// `criar_rascunho_cadastro` do agent.mjs de fato a usa e expira o anterior. Sem ele, apagar as 4
// linhas da ligação deixaria os 13 testes acima VERDES com o defeito de volta em produção.
await t('agent.mjs liga o dedupe no criar_rascunho_cadastro', async () => {
  const fonte = (await import('node:fs')).readFileSync(new URL('../src/agent.mjs', import.meta.url), 'utf8');
  const caso = fonte.slice(fonte.indexOf("case 'criar_rascunho_cadastro'"), fonte.indexOf("case 'criar_rascunho_titularidade'"));
  assert.ok(/DEDUPE\.registrarRascunho/.test(caso), 'o handler do cadastro não chama registrarRascunho');
  assert.ok(/ENGINE\.substituirRascunho/.test(caso), 'o handler não expira o rascunho anterior — voltam os 2 cards');
});

await t('o engine expira o anterior E fecha a linha da fila junto', async () => {
  const fonte = (await import('node:fs')).readFileSync(new URL('../src/write/engine.mjs', import.meta.url), 'utf8');
  const fn = fonte.slice(fonte.indexOf('export async function substituirRascunho'), fonte.indexOf('export async function criarRascunho'));
  assert.ok(/fecharFilaDoDraft/.test(fn), 'expirou o rascunho sem fechar a fila — sobra linha órfã aberta para sempre');
  assert.ok(/status !== 'pendente'/.test(fn), 'sem a guarda de status, um card já aprovado seria apagado');
});

console.log(`\ntest_dedupe_rascunho: ${ok} OK`);
