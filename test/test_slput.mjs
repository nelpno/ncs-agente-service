// test_slput.mjs — testa slPut em DRY_RUN + o gate por ação WRITE_REAL_ACTIONS (Onda C)
process.env.DRY_RUN_WRITES = 'true'; // antes do import
const { slPut, acaoGravaReal } = await import('../src/superlogica_write.mjs');

let falhas = 0;
const ok = (c, m) => {
  console.log(`${c ? 'OK ' : 'FALHA'} ${m}`);
  if (!c) falhas++;
};

// Teste 1: DRY_RUN retorna ok+dryRun sem rede
const r = await slPut('unidades/post', { 'contatos[0][ST_NOME_CON]': 'Fulano' });
ok(r.ok === true && r.dryRun === true, 'DRY_RUN retorna ok+dryRun sem rede');

// Teste 2: ecoa o payload p/ inspeção
ok(r.echo && r.echo['contatos[0][ST_NOME_CON]'] === 'Fulano', 'ecoa o payload p/ inspeção');

// Teste 3: múltiplos campos
const r2 = await slPut('unidades/post', {
  'contatos[0][ST_NOME_CON]': 'Fulano Silva',
  'contatos[0][ID_LABEL_TRES]': '7',
  'contatos[0][ST_EMAIL_CON]': 'fulano@test.com',
});
ok(r2.ok === true && Object.keys(r2.echo).length === 3, 'múltiplos campos ecoados');

// Teste 4: WRITE_REAL_ACTIONS — gate POR AÇÃO (sair do DRY sem destravar tudo)
delete process.env.WRITE_REAL_ACTIONS;
ok(acaoGravaReal('titularidade') === false, 'sem WRITE_REAL_ACTIONS: nenhuma ação grava real');
ok(acaoGravaReal(null) === false, 'actionId nulo: nunca real (não vaza)');
process.env.WRITE_REAL_ACTIONS = 'titularidade';
ok(acaoGravaReal('titularidade') === true, 'titularidade no allowlist: grava real');
ok(acaoGravaReal('cadastro_inquilino') === false, 'cadastro FORA do allowlist: continua DRY');
// slPut de ação FORA do allowlist continua DRY mesmo com WRITE_REAL_ACTIONS setado (não vaza escrita real)
const r3 = await slPut('unidades/post', { a: '1' }, 'PUT', 'cadastro_inquilino');
ok(r3.dryRun === true, 'slPut cadastro fora do allowlist -> DRY (não vaza)');
delete process.env.WRITE_REAL_ACTIONS;
// slPut de titularidade SEM allowlist -> DRY (default seguro)
const r4 = await slPut('unidades/post', { a: '1' }, 'PUT', 'titularidade');
ok(r4.dryRun === true, 'slPut titularidade sem allowlist -> DRY (default)');
// actionId ausente (chamada antiga) -> DRY como antes (retrocompatível)
const r5 = await slPut('unidades/post', { a: '1' });
ok(r5.dryRun === true, 'sem actionId (assinatura antiga) -> DRY, retrocompatível');

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
