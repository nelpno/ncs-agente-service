// test_slput.mjs — testa slPut em DRY_RUN
process.env.DRY_RUN_WRITES = 'true'; // antes do import
const { slPut } = await import('../src/superlogica_write.mjs');

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

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
