// test/test_registry.mjs
import { registerAction, getAction, WRITE_ACTIONS } from '../src/write/registry.mjs';

let falhas = 0;

const ok = (condicao, mensagem) => {
  if (condicao) {
    console.log(`OK ${mensagem}`);
  } else {
    console.log(`FALHA ${mensagem}`);
    falhas++;
  }
};

// Teste 1: registra e recupera por id
registerAction({ id: 'fake', validar: () => ({ ok: true, erros: [] }) });
ok(getAction('fake')?.id === 'fake', 'registra e recupera por id');

// Teste 2: id desconhecido = undefined
ok(getAction('nao_existe') === undefined, 'id desconhecido = undefined');

// Teste 3: WRITE_ACTIONS exposto
ok(typeof WRITE_ACTIONS === 'object', 'WRITE_ACTIONS exposto');

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
