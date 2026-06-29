// test_painel.mjs — render do painel é puro e mostra os campos + ações
import { renderPainel, passcodeOk } from '../src/write/painel.mjs';
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

const draft = { token: 'tk', acao: 'cadastro_inquilino', status: 'pendente', time: 'Recepção',
  conflito: { conflito: true, detalhe: 'semelhante' },
  render: { campos: [{ label: 'Nome', valor: 'João' }], diff: [], snapshotResumo: '1 contato hoje' } };
const html = renderPainel(draft);
ok(html.includes('João') && html.includes('Recepção'), 'mostra dados + time');
ok(html.includes('Aprovar') && html.includes('Rejeitar'), 'tem botões de ação');
ok(html.toLowerCase().includes('semelhante'), 'mostra alerta de conflito');
ok(renderPainel(draft, 'seg123').includes('seg123'), 'injeta o passcode nos forms (p/ os POSTs)');
ok(passcodeOk('seg', 'seg') === true && passcodeOk('x', 'seg') === false, 'passcode confere');
console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
