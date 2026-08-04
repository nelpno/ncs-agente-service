// test_carteira.mjs — testes determinísticos (sem LLM, sem rede) da tool consultar_carteira_ncs.
// Cobre os casos REAIS que motivaram a tool (conversas de 04/08/2026) + a regra de ouro: nunca
// transformar "não encontrei" em "a NCS não administra".
import { consultar_carteira_ncs, _reloadCarteira } from '../src/carteira.mjs';

_reloadCarteira();
let falhas = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK ' : 'FALHA'} ${msg}`); if (!cond) falhas++; };

// ---------------------------------------------------------- 1) os casos que a Ana errou em 04/08
// conv 554: "Vocês administram o Edifício Residencial Park?" -> ela nao confirmou (o Park E da NCS)
const park = consultar_carteira_ncs({ condominio: 'Edifício Residencial Park' });
ok(park.encontrou && /PARK/i.test(park.nome || ''), 'conv 554: "Edifício Residencial Park" -> encontra');

// conv 545: "Vcs estão administrando ô LHarmonie?" (sem apostrofo, como a pessoa digitou)
const lh = consultar_carteira_ncs({ condominio: 'LHarmonie' });
ok(lh.encontrou && /HARMONIE/i.test(lh.nome || ''), 'conv 545: "LHarmonie" (sem apóstrofo) -> encontra');

// conv 313 (29/07): "Vocês administram o Parque dos Trilhos?"
const tr = consultar_carteira_ncs({ condominio: 'Parque dos Trilhos' });
ok(tr.encontrou && /TRILHOS/i.test(tr.nome || ''), 'conv 313: "Parque dos Trilhos" -> encontra');

// ---------------------------------------------------------- 2) grafias como a pessoa escreve
for (const [q, esperado] of [
  ['Condomínio Vancouver', 'VANCOUVER'],      // palavra do meio ("RESIDENCIAL") atravessa a substring
  ['Rosas de Ouro', 'ROSA DE OURO'],          // plural: o ERP grava no singular
  ['lume', 'LUME'],
  ['allure', 'ALLURE'],
  ['SEIVA', 'SEIVA'],                          // cliente NOVO (entrou em 04/08) - prova que a base atualizou
]) {
  const r = consultar_carteira_ncs({ condominio: q });
  ok(r.encontrou && new RegExp(esperado, 'i').test(r.nome || r.candidatos.join(' ')), `"${q}" -> ${esperado}`);
}

// ---------------------------------------------------------- 3) ambiguidade legítima continua ambígua
const cedros = consultar_carteira_ncs({ condominio: 'Cedros' });
ok(cedros.ambiguo && cedros.candidatos.length >= 2, `"Cedros" -> ambíguo (${cedros.candidatos.length} candidatos), pergunta qual`);

// "Salto Grande I" NAO pode casar dentro de "Salto Grande III" (condominios diferentes, sindicos
// diferentes) - a regressao que o pino de nao-regressao pegou em 29/07.
const sg1 = consultar_carteira_ncs({ condominio: 'ASSOCIACAO JARDIM SALTO GRANDE I' });
ok(sg1.encontrou && !sg1.ambiguo && /SALTO GRANDE I$/i.test(sg1.nome || ''), '"Salto Grande I" não casa com "Salto Grande III"');

// ---------------------------------------------------------- 4) REGRA DE OURO: nao negar categoricamente
const fora = consultar_carteira_ncs({ condominio: 'Residencial Villagio do Sol' }); // conv 516, nao e da NCS
ok(!fora.encontrou, 'condomínio de fora -> encontrou:false');
ok(/n[ãa]o afirme/i.test(fora.resumo), 'condomínio de fora -> o resumo PROÍBE afirmar que a NCS não administra');
ok(!/n[ãa]o administra(mos)?\b(?!.*pode ser)/i.test(fora.resumo.replace(/NÃO afirme que a NCS não administra[^.]*/i, '')),
  'condomínio de fora -> resumo não contém negativa categórica solta');
ok(/nome completo|endere[çc]o|equipe/i.test(fora.resumo), 'condomínio de fora -> orienta pedir nome completo / falar com a equipe');

// ---------------------------------------------------------- 5) entrada vazia nao chuta
const vazio = consultar_carteira_ncs({});
ok(!vazio.encontrou && /nome do condom/i.test(vazio.resumo), 'sem condomínio -> pede o nome, não chuta');

// ---------------------------------------------------------- 6) a base tem o tamanho esperado e SEM PII
const qualquer = consultar_carteira_ncs({ condominio: 'lume' });
ok(qualquer.total_carteira === 58, `base tem 58 condomínios (tem ${qualquer.total_carteira})`);
const bruto = JSON.stringify(JSON.parse(
  (await import('node:fs')).readFileSync(
    new URL('../data/carteira/condominios-administrados.json', import.meta.url), 'utf8')));
ok(!/55\d{10,11}/.test(bruto), 'base pública NÃO contém telefone');
ok(!/SCALISE|FURLAN|BELIS[ÁA]RIO/i.test(bruto), 'base pública NÃO contém nome de síndico');

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
