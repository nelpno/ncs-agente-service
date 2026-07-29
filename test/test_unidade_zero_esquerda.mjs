// test_unidade_zero_esquerda.mjs — o morador diz "apartamento 51"; o sistema grava "051".
//
// POR QUE ISTO EXISTE: `_match` comparava o número da unidade como TEXTO ("051" === "51" é falso),
// então quem dissesse o apartamento sem o zero à esquerda não era identificado pela via unidade+nome
// (a via que existe justamente para quem não dá CPF). Medido na base real em 29/07/2026:
// **2.325 de 3.798 unidades (61,2%), em 48 dos 59 condomínios** são gravadas com zero à esquerda —
// no Rosa de Ouro são 100% delas (011…161).
//
// ⚠️ O CUIDADO QUE O FIX EXIGE: no Tivoli (164) existem "10 G" e "010 G" como unidades de DONOS
// DIFERENTES. Casar zero-à-esquerda cegamente as colapsaria e entregaria dado da unidade errada.
// Por isso o match exato pontua ACIMA do normalizado: `resolver_cadastro` só devolve os matches de
// score máximo, então havendo a unidade exata ela ganha sozinha, e a normalizada só aparece quando
// não existe exata. A desambiguação sai de graça do mecanismo que já existia.
//
// Uso: node test/test_unidade_zero_esquerda.mjs

import { _match, _parseUnidade, resolver_cadastro } from '../src/superlogica.mjs';

let pass = 0, fail = 0;
const ck = (label, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  console.log((ok ? '  OK  ' : '  FAIL') + ' ' + label + ' -> ' + JSON.stringify(got));
  if (!ok) { console.log('        esperado: ' + JSON.stringify(exp)); fail++; } else pass++;
};

const R = (over) => ({ st_cpf_con: '', st_telefone_con: '', st_nome_con: '', st_bloco_uni: '', st_unidade_uni: '', ...over });
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
const q = ({ nome, unidade }) => ({ cpfd: '', telTail: null, nomeN: norm(nome), unidadeQ: unidade ? _parseUnidade(unidade) : null });

console.log('\n=== test_unidade_zero_esquerda.mjs ===\n');

// ── 1. o bug: "apto 51" tem de achar a unidade gravada como "051" ────────────
ck('“apto 51” acha a unidade 051 (zero à esquerda)',
  _match(R({ st_nome_con: 'MARIANA FERREIRA LOPES', st_unidade_uni: '051' }), q({ nome: 'Mariana Ferreira Lopes', unidade: 'apto 51' })),
  { criterio: 'unidade_nome', score: 87 });

ck('“apartamento 11” acha a unidade 011',
  _match(R({ st_nome_con: 'JOSE ALVES', st_unidade_uni: '011' }), q({ nome: 'Jose Alves', unidade: 'apartamento 11' })),
  { criterio: 'unidade_nome', score: 87 });

// ── 2. o exato continua valendo mais (Tivoli: "10 G" ≠ "010 G") ──────────────
ck('unidade EXATA mantém 88 (não foi rebaixada)',
  _match(R({ st_nome_con: 'MARIANA FERREIRA LOPES', st_unidade_uni: '051' }), q({ nome: 'Mariana Ferreira Lopes', unidade: 'apto 051' })),
  { criterio: 'unidade_nome', score: 88 });

ck('Tivoli: “010 G” casa EXATO na 010 (88)',
  _match(R({ st_nome_con: 'DONO A', st_unidade_uni: '010 G' }), q({ nome: 'Dono A', unidade: 'unidade 010' })),
  { criterio: 'unidade_nome', score: 88 });

ck('Tivoli: a vizinha “10 G” casa só NORMALIZADO (87) — perde para a exata',
  _match(R({ st_nome_con: 'DONO B', st_unidade_uni: '10 G' }), q({ nome: 'Dono B', unidade: 'unidade 010' })),
  { criterio: 'unidade_nome', score: 87 });

// ── 3. sem o nome continua sendo sinal fraco (LGPD: não libera sozinho) ──────
ck('só a unidade normalizada, sem nome → fraca 34 (não libera)',
  _match(R({ st_nome_con: 'OUTRA PESSOA', st_unidade_uni: '051' }), q({ nome: 'Mariana Lopes', unidade: 'apto 51' })),
  { criterio: 'unidade_fraca', score: 34 });

ck('só a unidade exata, sem nome → fraca 35 (inalterado)',
  _match(R({ st_nome_con: 'OUTRA PESSOA', st_unidade_uni: '051' }), q({ nome: 'Mariana Lopes', unidade: 'apto 051' })),
  { criterio: 'unidade_fraca', score: 35 });

// ── 4. não pode casar número diferente ───────────────────────────────────────
ck('“apto 52” NÃO casa a unidade 051',
  _match(R({ st_nome_con: 'MARIANA FERREIRA LOPES', st_unidade_uni: '051' }), q({ nome: 'Mariana Ferreira Lopes', unidade: 'apto 52' })),
  { criterio: 'nome_exato', score: 60 });

ck('“apto 510” NÃO casa a unidade 051 (não é o mesmo número)',
  _match(R({ st_unidade_uni: '051', st_nome_con: 'ZZZ' }), q({ nome: 'ninguem aqui', unidade: 'apto 510' })),
  null);

// ── 5. ponta a ponta: o que resolver_cadastro devolve ────────────────────────
const CONDOS = [{ id: 172, nome: 'CONDOMINIO EDIFICIO ROSA DE OURO' }, { id: 164, nome: 'ASSOCIACAO RESIDENCIAL TIVOLI' }];
const PORTAS = {
  // ⚠️ DOIS moradores com o mesmo nome no MESMO condomínio, em unidades diferentes: é o que impede
  // este teste de passar pelo nome (era o furo da 1ª versão dele — passava verde sem o fix). Só a
  // unidade desambigua, que é exatamente o mecanismo sob teste.
  172: [
    { st_cpf_con: '', id_unidade_uni: '13068', st_bloco_uni: 'APTO', st_unidade_uni: '051', st_nome_con: 'MARIANA FERREIRA LOPES', id_label_tres: '1' },
    { st_cpf_con: '', id_unidade_uni: '13099', st_bloco_uni: 'APTO', st_unidade_uni: '131', st_nome_con: 'MARIANA FERREIRA LOPES', id_label_tres: '1' },
  ],
  // as duas unidades do Tivoli que NÃO podem ser confundidas (donos diferentes)
  164: [
    { st_cpf_con: '', id_unidade_uni: '5001', st_bloco_uni: '', st_unidade_uni: '010 G', st_nome_con: 'CARLOS DONO', id_label_tres: '1' },
    { st_cpf_con: '', id_unidade_uni: '5002', st_bloco_uni: '', st_unidade_uni: '10 G', st_nome_con: 'CARLOS DONO', id_label_tres: '1' },
  ],
};
const deps = () => ({
  listCondominios: async () => CONDOS,
  slGet: async (_ca, p) => PORTAS[p.idCondominio] || [],
});

{
  const r = await resolver_cadastro({ nome: 'Mariana Ferreira Lopes', unidade: 'apto 51', condominio: 'Rosa de Ouro' }, deps());
  // o critério importa: com duas homônimas, cair em `nome_exato` devolveria AS DUAS unidades —
  // é assim que hoje se entrega o boleto da unidade errada.
  ck('ponta a ponta: “apto 51” identifica pela UNIDADE, não pelo nome', r.criterio, 'unidade_nome');
  ck('ponta a ponta: entre duas homônimas, devolve só a da 051', [r.unidades?.length, r.unidades?.[0]?.identificacao], [1, 'APTO / 051']);
  ck('ponta a ponta: confiança alta (unidade + nome)', r.confianca, 'alta');
}
{
  // o caso que o fix NÃO pode quebrar: pediu a 010, existe a 010 → devolve SÓ ela
  const r = await resolver_cadastro({ nome: 'Carlos Dono', unidade: 'unidade 010', condominio: 'Tivoli' }, deps());
  ck('Tivoli: pedindo a 010 devolve UMA unidade (a exata), não as duas', r.unidades?.length, 1);
  ck('Tivoli: e é a “010 G”, não a vizinha “10 G”', r.unidades?.[0]?.identificacao, '010 G');
}
{
  // e quando só existe a forma sem zero, a busca com zero acha
  const r = await resolver_cadastro({ nome: 'Carlos Dono', unidade: 'unidade 10', condominio: 'Tivoli' }, deps());
  ck('Tivoli: pedindo a 10 devolve a exata “10 G”', [r.unidades?.length, r.unidades?.[0]?.identificacao], [1, '10 G']);
}

console.log(`\n${pass} OK / ${fail} FALHAS`);
process.exit(fail ? 1 : 0);
