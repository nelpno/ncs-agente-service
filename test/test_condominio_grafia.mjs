// test_condominio_grafia.mjs — o condomínio escrito como as PESSOAS escrevem, não como o ERP grava.
//
// POR QUE ISTO EXISTE: o filtro de condomínio do `resolver_cadastro` era
// `nomeDoERP.toLowerCase().includes(oQueFoiDito.toLowerCase())` — sem acento, sem plural, sem tolerar
// palavra do meio. Quando não casava, `condos` continuava com os 59 e a busca varria tudo: não errava
// escolhendo, mas ficava ambígua (a mesma unidade "051" existe em 9 condomínios) e podia casar um
// homônimo em outro prédio. Medido em 29/07/2026: **12 dos 55 nomes das NOSSAS próprias bases**
// (horarios-mudanca.json, condominio_contatos.json) não casavam — incluindo "ROSAS DE OURO", que é
// como o Fernando, a equipe e a nossa base escrevem o condomínio gravado no ERP como "ROSA DE OURO".
//
// ⚠️ O QUE NÃO PODE QUEBRAR: "Cedros" serve a DOIS condomínios (Vistas do Botânico - Cedros e
// Cedros do Campo). Ambíguo tem de continuar devolvendo os dois — quem decide é a pessoa, nunca o
// programa. Essa colisão já quebrou um condomínio em silêncio antes.
//
// Uso: node test/test_condominio_grafia.mjs

import { _filtrarCondos, resolver_cadastro } from '../src/superlogica.mjs';

let pass = 0, fail = 0;
const ck = (label, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  console.log((ok ? '  OK  ' : '  FAIL') + ' ' + label + ' -> ' + JSON.stringify(got));
  if (!ok) { console.log('        esperado: ' + JSON.stringify(exp)); fail++; } else pass++;
};

// nomes REAIS do ERP (os que importam para os casos abaixo)
const CONDOS = [
  { id: 172, nome: 'CONDOMINIO EDIFICIO ROSA DE OURO' },
  { id: 121, nome: 'Edifício Jatiúca Blocos I e II' },
  { id: 178, nome: 'CONDOMINIO RESIDENCIAL VANCOUVER' },
  { id: 175, nome: 'VISTAS DO BOTANICO - CEDROS' },
  { id: 187, nome: 'ASSOCIACAO DOS MORADORES DO RESIDENCIAL SALTO GRANDE - CEDROS DO CAMPO' },
  { id: 112, nome: 'Associação de Moradores do Jardim Acácias' },
  { id: 176, nome: 'VITTA PRACAS DO SOL' },
  { id: 184, nome: 'VITTA PAIRÁS' },
  { id: 15, nome: 'CONDOMÍNIO EDIFÍCIO RESIDENCIAL PARK' },
  // numeral romano no fim: "…GRANDE I" é substring de "…GRANDE III". Antes do fix quem separava os
  // dois era o ACENTO de "ASSOCIAÇÃO" (por acidente) — ao normalizar, eles colidiram. São
  // condomínios diferentes, com síndicos e boletos diferentes.
  { id: 185, nome: 'ASSOCIACAO JARDIM SALTO GRANDE I' },
  { id: 166, nome: 'ASSOCIAÇÃO JARDIM SALTO GRANDE III' },
  // a equipe diz "CDHU"; o ERP grava "CDHU1" colado. Prefixo de palavra tem de casar — mas só
  // depois que os degraus mais exatos falharem, senão ele reabriria a colisão do Salto Grande.
  { id: 49, nome: 'CONDOMÍNIO 390 - 1AB - CDHU1 / MOBILE-SERVICOS COMBINADOS DE APOIO PAR' },
];
const nomes = (r) => r.map((c) => c.id).sort((a, b) => a - b);

console.log('\n=== test_condominio_grafia.mjs ===\n');

// ── 1. o caso de hoje: plural a mais ─────────────────────────────────────────
ck('“Rosas de Ouro” (com S) acha o ROSA DE OURO', nomes(_filtrarCondos(CONDOS, 'Rosas de Ouro')), [172]);
ck('“Rosa de Ouro” (grafia do ERP) continua achando', nomes(_filtrarCondos(CONDOS, 'Rosa de Ouro')), [172]);

// ── 2. acento: a pessoa digita sem, o ERP grava com (e vice-versa) ───────────
ck('“Jatiuca” sem acento acha “Jatiúca”', nomes(_filtrarCondos(CONDOS, 'Jatiuca')), [121]);
ck('“Pairas” sem acento acha “PAIRÁS”', nomes(_filtrarCondos(CONDOS, 'Pairas')), [184]);
ck('“Praças do Sol” com cedilha acha “PRACAS DO SOL”', nomes(_filtrarCondos(CONDOS, 'Praças do Sol')), [176]);
ck('“Acácias I” acha o Jardim Acácias', nomes(_filtrarCondos(CONDOS, 'Acácias')), [112]);

// ── 3. palavra do meio (o caso Vancouver) ────────────────────────────────────
ck('“Condomínio Vancouver” acha “CONDOMINIO RESIDENCIAL VANCOUVER”', nomes(_filtrarCondos(CONDOS, 'Condomínio Vancouver')), [178]);
ck('“Residencial Park” acha o PARK', nomes(_filtrarCondos(CONDOS, 'Residencial Park')), [15]);

// ── 4. ambiguidade PRECISA continuar ambígua (não escolher é a regra) ────────
ck('“Cedros” continua servindo aos DOIS condomínios', nomes(_filtrarCondos(CONDOS, 'Cedros')), [175, 187]);
ck('“Cedros do Campo” (nome completo) desambigua sozinho', nomes(_filtrarCondos(CONDOS, 'Cedros do Campo')), [187]);

// ── 4b. numeral romano: “GRANDE I” não pode arrastar “GRANDE III” ────────────
ck('“Salto Grande I” NÃO traz o Salto Grande III', nomes(_filtrarCondos(CONDOS, 'ASSOCIACAO JARDIM SALTO GRANDE I')), [185]);
ck('“Salto Grande III” acha só o III', nomes(_filtrarCondos(CONDOS, 'Salto Grande III')), [166]);
// 187 entra de direito: o nome oficial dele é "…RESIDENCIAL SALTO GRANDE - CEDROS DO CAMPO"
ck('“Salto Grande” (sem número) fica ambíguo entre os três — pessoa decide', nomes(_filtrarCondos(CONDOS, 'Salto Grande')), [166, 185, 187]);

// ── 4c. prefixo de palavra: “CDHU” acha “CDHU1” ──────────────────────────────
ck('“CDHU” acha o CDHU1 (prefixo colado no ERP)', nomes(_filtrarCondos(CONDOS, 'CDHU')), [49]);
ck('prefixo curto demais não vale (“ro” não varre meio mundo)', _filtrarCondos(CONDOS, 'ro').length, CONDOS.length);

// ── 5. o que não existe não pode inventar match ──────────────────────────────
ck('condomínio inexistente → devolve todos (mantém o comportamento de hoje)', _filtrarCondos(CONDOS, 'Palácio de Versalhes').length, CONDOS.length);
ck('só palavra estrutural (“condomínio”) → não identifica nada, devolve todos', _filtrarCondos(CONDOS, 'condominio').length, CONDOS.length);
ck('vazio → devolve todos', _filtrarCondos(CONDOS, '').length, CONDOS.length);

// ── 6. ponta a ponta: a grafia errada não pode mais espalhar a busca ─────────
const PORTAS = {
  172: [{ st_cpf_con: '', id_unidade_uni: '13068', st_bloco_uni: 'APTO', st_unidade_uni: '051', st_nome_con: 'MARIANA FERREIRA LOPES', id_label_tres: '1' }],
  // MESMA unidade "051" em outro condomínio: é o que a varredura ampla trazia junto
  178: [{ st_cpf_con: '', id_unidade_uni: '99001', st_bloco_uni: '', st_unidade_uni: '051', st_nome_con: 'MARIANA FERREIRA LOPES', id_label_tres: '1' }],
};
let varridos = 0;
const deps = () => ({
  listCondominios: async () => CONDOS,
  slGet: async (_ca, p) => { varridos++; return PORTAS[p.idCondominio] || []; },
});

{
  varridos = 0;
  const r = await resolver_cadastro({ nome: 'Mariana Ferreira Lopes', unidade: 'apto 51', condominio: 'Rosas de Ouro' }, deps());
  ck('ponta a ponta: “Rosas de Ouro” varre 1 condomínio, não os 9', varridos, 1);
  ck('ponta a ponta: devolve só a unidade do Rosa de Ouro', [r.unidades?.length, r.unidades?.[0]?.id_condominio], [1, 172]);
}

console.log(`\n${pass} OK / ${fail} FALHAS`);
process.exit(fail ? 1 : 0);
