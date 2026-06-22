// test_gruvi.mjs — testes determinísticos (sem LLM, sem rede) da busca do vídeo how-to do app Gruvi.
// Cobre: casa por tema/título (boleto, facial, visitante), assunto fora da base -> encontrou:false (não inventa link). Exit 1 em falha.
import { buscar_video } from '../src/gruvi.mjs';

let falhas = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK ' : 'FALHA'} ${msg}`); if (!cond) falhas++; };

// 1) boleto -> vídeo de boletos (url estável do YouTube)
const b = buscar_video('como eu pego o meu boleto no aplicativo?');
ok(b.encontrou && /youtu\.be\/KT8GC760H_s/.test(b.url), `boleto -> ${b.url}`);

// 2) facial -> vídeo de cadastro da facial
const f = buscar_video('preciso cadastrar o reconhecimento facial');
ok(f.encontrou && /youtu\.be\/fYhhC3khtwk/.test(f.url), `facial -> ${f.url}`);

// 3) visitante -> vídeo de liberar visitantes
const v = buscar_video('como libero a entrada de um visitante');
ok(v.encontrou && /youtu\.be\/Uw5ySR1cUo0/.test(v.url), `visitante -> ${v.url}`);

// 4) assunto FORA do app -> encontrou:false (NÃO inventa link)
ok(buscar_video('qual a receita de bolo de chocolate').encontrou === false, 'fora do app -> encontrou:false');

// 5) vazio -> encontrou:false
ok(buscar_video('').encontrou === false, 'vazio -> encontrou:false');
ok(buscar_video().encontrou === false, 'sem arg -> encontrou:false');

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
