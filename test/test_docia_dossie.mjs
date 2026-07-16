// test_docia_dossie.mjs — o acumulador das "4 fotos seguidas" (puro, sem rede).
// Os dois riscos reais do store em memória: contaminar a próxima análise e vazar memória.
import { adicionarPeca, pecasDe, limpar, _store } from '../src/docia/dossie.mjs';

let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };
const foto = (n) => ({ mime: 'image/jpeg', buf: Buffer.alloc(1024, n), nome: `p${n}.jpg` });
const T0 = 1_000_000;

// ---------- acumula na ordem (página 1 é página 1) ----------
limpar('ct-1');
ok(pecasDe('ct-1', T0).length === 0, 'dossiê nasce vazio');
ok(adicionarPeca('ct-1', foto(1), T0).total === 1, '1ª página entra');
ok(adicionarPeca('ct-1', foto(2), T0 + 5000).total === 2, '2ª página entra');
const p = pecasDe('ct-1', T0 + 6000);
ok(p.length === 2, 'as duas páginas voltam');
ok(p[0].nome === 'p1.jpg' && p[1].nome === 'p2.jpg', 'ordem de chegada preservada (pág.1 primeiro)');
ok(Buffer.isBuffer(p[0].buf), 'o binário volta como Buffer, pronto p/ o Gemini');

// ---------- isolamento por morador ----------
adicionarPeca('ct-2', foto(9), T0);
ok(pecasDe('ct-1', T0).length === 2 && pecasDe('ct-2', T0).length === 1, 'dossiês de moradores diferentes não se misturam');

// ---------- RISCO 1: contaminar a próxima análise ----------
// A sessão do morador vive 120min. Sem limpar após analisar, a página de um contrato antigo entra
// calada na análise do próximo documento e o laudo mistura dois papéis diferentes.
limpar('ct-1');
ok(pecasDe('ct-1', T0).length === 0, 'limpar() esvazia o dossiê (chamado logo após analisar)');
ok(pecasDe('ct-2', T0).length === 1, 'limpar() de um morador não afeta o outro');

// ---------- janela: dossiê velho não ressuscita ----------
adicionarPeca('ct-3', foto(1), T0);
ok(pecasDe('ct-3', T0 + 29 * 60 * 1000).length === 1, 'dentro da janela de 30min o dossiê está lá');
ok(pecasDe('ct-3', T0 + 31 * 60 * 1000).length === 0, 'passou de 30min → dossiê expira (não contamina)');
adicionarPeca('ct-4', foto(1), T0);
adicionarPeca('ct-4', foto(2), T0 + 20 * 60 * 1000);
ok(pecasDe('ct-4', T0 + 45 * 60 * 1000).length === 2, 'página nova renova a janela (morador lento não perde o dossiê)');

// ---------- RISCO 2: vazamento de memória ----------
limpar('ct-5');
for (let i = 0; i < 10; i++) adicionarPeca('ct-5', foto(i), T0);
const r = adicionarPeca('ct-5', foto(11), T0);
ok(r.ok === false && r.motivo === 'muitas_pecas', 'teto de peças por morador (store em memória não vira vazamento)');
ok(pecasDe('ct-5', T0).length === 10, 'o teto não corrompe o que já estava lá');

limpar('ct-6');
const gigante = { mime: 'image/jpeg', buf: Buffer.alloc(41 * 1024 * 1024, 1) };
ok(adicionarPeca('ct-6', gigante, T0).motivo === 'muito_grande', 'teto de bytes por dossiê');

// o gc roda sozinho: dossiê expirado sai do Map (não fica ocupando memória para sempre)
limpar('ct-7');
adicionarPeca('ct-7', foto(1), T0);
ok(_store.has('ct-7'), 'dossiê está no store');
pecasDe('qualquer', T0 + 60 * 60 * 1000); // qualquer acesso depois da janela dispara o gc
ok(!_store.has('ct-7'), 'gc remove dossiê expirado do store (memória volta sozinha)');

// ---------- entrada inválida não quebra ----------
ok(adicionarPeca('', foto(1), T0).ok === false, 'sem chave → recusa');
ok(adicionarPeca('ct-8', { mime: 'image/jpeg', buf: Buffer.alloc(0) }, T0).ok === false, 'buffer vazio → recusa');
ok(adicionarPeca('ct-8', {}, T0).ok === false, 'peça sem buffer → recusa, não lança');

['ct-2', 'ct-3', 'ct-4', 'ct-5', 'ct-6'].forEach(limpar);
console.log(falhas === 0 ? '\n✅ todos os checks passaram' : `\n❌ ${falhas} falha(s)`);
process.exitCode = falhas ? 1 : 0;
