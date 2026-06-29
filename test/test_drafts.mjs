// test_drafts.mjs — ciclo de vida do draft (sem Redis = fallback Map)
import { criarDraft, getDraftByToken, getDraft, updateDraft } from '../src/write/drafts.mjs';

let falhas = 0;
const ok = (c, m) => {
  console.log(`${c ? 'OK ' : 'FALHA'} ${m}`);
  if (!c) falhas++;
};

// Test: criação de draft
const d = await criarDraft({
  acao: 'cadastro_inquilino',
  dados: { nome: 'X' },
  snapshot: [],
  solicitante: null,
  time: 'Recepção',
});
ok(d.id && d.token && d.token.length >= 16, 'gera id + token forte');
ok(d.status === 'pendente', 'nasce pendente');
ok(d.expiraEm > Date.now(), 'tem expiração futura (SLA)');

// Test: recuperar por token
const byTok = await getDraftByToken(d.token);
ok(byTok && byTok.id === d.id, 'recupera por token');

// Test: atualizar
await updateDraft(d.id, { status: 'gravado' });
ok((await getDraft(d.id)).status === 'gravado', 'updateDraft persiste patch');

// Test: token inválido
ok((await getDraftByToken('token-inexistente')) === null, 'token inválido retorna null');

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
