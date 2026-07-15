// test_sessao_unidades.mjs — o rótulo da unidade sobrevive de um turno para o outro?
//
// Bug real (pego só no ensaio em PROD, 15/07): o card mostrava "unidade 14381" (id de banco) mesmo
// depois do fix, porque o rótulo era guardado em `session.unidades` — e o saveSession() serializa
// SÓ {messages, ctx, touched}. Toda chave fora dessas era descartada EM SILÊNCIO. Teste de unidade
// não pegava: nenhum passava pelo round-trip save→get. Este passa.
import { getSession, saveSession, resetSession } from '../src/memory.mjs';
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

const chave = 'test-unidades-' + Math.floor(Math.random() * 1e6);

// turno 1: o resolver_cadastro colheu o rótulo do ERP e guardou onde o loop manda
const s1 = await getSession(chave);
s1.ctx ||= {};
(s1.ctx.unidades ||= {})['14381'] = 'QUADRA 20 / LOTE 0314';
s1.messages.push({ role: 'user', content: 'oi' });
await saveSession(chave, s1);

// turno 4: requisição NOVA — só a sessão atravessa
const s2 = await getSession(chave);
ok(s2?.ctx?.unidades?.['14381'] === 'QUADRA 20 / LOTE 0314',
  `rótulo sobrevive ao round-trip da sessão (veio: ${JSON.stringify(s2?.ctx?.unidades)})`);

// ⚠️ POR QUE O BUG ESCAPOU DOS TESTES (vale p/ qualquer coisa que se guarde na sessão):
// sem REDIS_URL, o memory.mjs cai no fallback IN-MEMORY, que guarda o objeto POR REFERÊNCIA —
// então qualquer chave no topo "sobrevive" localmente. Em prod é Redis: JSON.stringify({messages,
// ctx, touched}) → o topo é descartado em silêncio. O fallback local NÃO é fiel ao Redis nesse
// ponto, e é por isso que só o ensaio contra produção pegou. Aqui a asserção que vale nos dois é a
// de cima (o rótulo em session.ctx). Não asserte o descarte do topo: passa/falha conforme o backend.
const s3 = await getSession(chave);
s3.unidades = { '999': 'NO TOPO' };
await saveSession(chave, s3);
const s4 = await getSession(chave);
console.log(`(informativo) chave no topo após round-trip: ${s4?.unidades ? 'sobreviveu (fallback in-memory)' : 'descartada (Redis)'} — por isso o rótulo mora em session.ctx`);

await resetSession(chave);
console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
