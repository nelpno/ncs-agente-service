// test_resolver_multi_condo.mjs — busca por CPF acha as unidades em TODOS os condomínios.
//
// POR QUE ISTO EXISTE: a varredura por CPF ia em lotes de 8 e PARAVA no primeiro lote com match
// forte ("achei o CPF, pronto") — premissa falsa. Medido na base real (15/07/2026): 207 CPFs têm
// unidade em 2+ condomínios e 181 deles têm uma unidade FORA do primeiro lote → a Ana entregava o
// boleto de um condomínio e era CEGA ao outro, sem avisar ninguém (falha silenciosa).
//
// Fixture pura (sem API, sem PII): 60 condomínios, o mesmo CPF no primeiro e no 51º.
// Uso: node test/test_resolver_multi_condo.mjs

import { resolver_cadastro } from '../src/superlogica.mjs';

let failures = 0;
function assert(condition, label) {
  if (condition) console.log('  OK  ', label);
  else { console.error('  FAIL', label); failures++; }
}

const CPF = '11122233344';
// 60 condomínios fake; o morador está no índice 0 (id 100) e no índice 50 (id 150)
const CONDOS = Array.from({ length: 60 }, (_, i) => ({ id: 100 + i, nome: `CONDO ${i}` }));
const PORTAS = {
  100: [{ st_cpf_con: '111.222.333-44', id_unidade_uni: '900', st_bloco_uni: 'QUADRA 08', st_unidade_uni: 'LOTE 20', st_nome_con: 'MARIA SILVA', id_label_tres: '1' }],
  150: [{ st_cpf_con: '11122233344', id_unidade_uni: '901', st_bloco_uni: '', st_unidade_uni: 'APTO 42', st_nome_con: 'MARIA SILVA', id_label_tres: '1' }],
};
let chamadas = 0;
const deps = () => ({
  listCondominios: async () => CONDOS,
  slGet: async (_ca, p) => { chamadas++; return PORTAS[p.idCondominio] || []; },
});

console.log('\n=== test_resolver_multi_condo.mjs ===\n');

// 1. O BUG: CPF sem condomínio → tem que achar as DUAS unidades (condos distantes na varredura)
{
  chamadas = 0;
  const r = await resolver_cadastro({ cpf: CPF }, deps());
  assert(r.encontrado === true, 'CPF em 2 condomínios → encontrado');
  assert(r.unidades?.length === 2, `acha as DUAS unidades (achou ${r.unidades?.length})`);
  const ids = (r.unidades || []).map((u) => String(u.id_condominio)).sort();
  assert(JSON.stringify(ids) === JSON.stringify(['100', '150']), 'as duas são de condomínios diferentes (100 e 150)');
  assert(r.criterio === 'cpf' && r.confianca === 'alta', 'critério cpf / confiança alta');
  assert(chamadas === 60, `varreu TODOS os condomínios antes de decidir (varreu ${chamadas})`);
}

// 2. Condomínio informado → segue barato (1 condomínio só), sem varrer os 60
{
  chamadas = 0;
  const r = await resolver_cadastro({ cpf: CPF, condominio: 'CONDO 0' }, deps());
  assert(r.unidades?.length === 1, 'com condomínio informado → só a unidade daquele condomínio');
  assert(String(r.unidades?.[0]?.id_condominio) === '100', '  (o condomínio pedido)');
  assert(chamadas === 1, `não varre a base toda à toa (chamou ${chamadas})`);
}

// 3. Sem match → não inventa (comportamento preservado)
{
  const r = await resolver_cadastro({ cpf: '99999999999' }, deps());
  assert(r.encontrado === false, 'CPF inexistente → encontrado:false');
  assert(r.motivo === 'cpf_nao_encontrado', '  motivo cpf_nao_encontrado');
}

// 4. CPF num condomínio só → continua funcionando (o caso comum, sem regressão)
{
  const r = await resolver_cadastro({ cpf: CPF, condominio: 'CONDO 50' }, deps());
  assert(r.unidades?.length === 1 && String(r.unidades[0].id_condominio) === '150', 'CPF em 1 condomínio → 1 unidade');
}

// 5. Busca por nome sem condomínio segue proibida (homônimos) — guarda preservada
{
  const r = await resolver_cadastro({ nome: 'MARIA SILVA' }, deps());
  assert(r.encontrado === false && r.motivo === 'nome_exige_condominio', 'nome sem condomínio → exige condomínio');
}

console.log('\n' + (failures === 0 ? '✓ Todos os testes passaram.' : `✗ ${failures} teste(s) FALHARAM.`) + '\n');
process.exit(failures > 0 ? 1 : 0);
