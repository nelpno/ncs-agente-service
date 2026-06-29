// test_responsaveis.mjs — filtro por unidade (responsaveis/index ignora idUnidade)
import { filtrarPorUnidade } from '../src/superlogica.mjs';
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

const dados = [
  { id_unidade_uni: '100', st_nome_con: 'A' },
  { id_unidade_uni: '200', st_nome_con: 'B' },
  { id_unidade_uni: '100', st_nome_con: 'C' },
];
const r = filtrarPorUnidade(dados, '100');
ok(r.length === 2 && r.every((x) => x.id_unidade_uni === '100'), 'filtra só a unidade pedida');
ok(filtrarPorUnidade(dados, '999').length === 0, 'unidade inexistente = vazio');
console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
