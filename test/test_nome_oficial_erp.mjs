// test_nome_oficial_erp.mjs — o nome OFICIAL do condomínio (o que aparece nas telas do Superlógica)
// tem de resolver para o catálogo.
//
// Achado em 04/08/2026 no uso real: `superlogica_nome` guarda o nome CURTO ("Allure", "Barbieri") e
// 39 dos 58 nomes oficiais NÃO casavam — "ALLURE CONDOMÍNIO RESORT" e "CONDOMÍNIO BARBIERI EDIFICIO
// BARBIERI I" davam "sem catálogo". Ficou mais grave no mesmo dia: a tool consultar_carteira_ncs
// passou a devolver o nome OFICIAL para a Ana, então quem copia esse nome para o Estagiário batia
// na parede. Corrigido adicionando o nome do ERP (bloco `condominio.nome`) como alias.
//
// Determinístico: sem LLM e sem rede.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregarCondominio } from '../gerador/src/gerar-lib.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DADOS = path.join(AQUI, '..', 'gerador', 'dados');
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };
const resolve = (n) => { try { return carregarCondominio(n).id; } catch { return null; } };

// ------------------------------------------------- 1) todo catálogo resolve pelo próprio nome do ERP
let semBloco = 0, testados = 0;
for (const f of fs.readdirSync(DADOS).filter((x) => x.endsWith('.json'))) {
  const d = JSON.parse(fs.readFileSync(path.join(DADOS, f), 'utf8'));
  const slug = f.replace('.json', '');
  const nomeErp = d.condominio && d.condominio.nome;
  if (!nomeErp) { semBloco++; continue; }
  testados++;
  const r = resolve(nomeErp);
  ok(r === slug, `"${nomeErp.slice(0, 52)}" -> ${slug}${r === slug ? '' : ` (veio ${r})`}`);
}
ok(testados >= 50, `testados ao menos 50 catálogos pelo nome do ERP (foram ${testados}; sem bloco condominio: ${semBloco})`);

// ------------------------------------------------- 2) os casos concretos que quebraram no uso real
for (const [nome, esperado] of [
  ['ALLURE CONDOMÍNIO RESORT', 'allure'],
  ['CONDOMÍNIO BARBIERI EDIFICIO BARBIERI I', 'barbieri'],
  ['ASSOCIACAO DE PROPRIETARIOS EM LOTEAMENTO ATLANTA', 'atlanta'],
  ['CONDOMÍNIO MINI SHOPPING DO CARMO', 'shop-do-carmo'],
  ['ASSOC DOS MORADORES DO RESID CAMPOS DE PIEMONTE - RESERVA DO CAMPO', 'reserva-do-campo'],
  ['ASSOC DE MORADORES DO LOT FECHADO JD RES MAGGIORE - RESID PIEMONTE', 'piemonte'],
]) {
  ok(resolve(nome) === esperado, `nome oficial "${nome.slice(0, 46)}..." -> ${esperado}`);
}

// ------------------------------------------------- 3) o nome CURTO continua funcionando (não regredir)
for (const [nome, esperado] of [
  ['Allure', 'allure'], ['Barbieri', 'barbieri'], ['Lume', 'lume'], ['Vancouver', 'vancouver'],
  ['Condomínio Vancouver', 'vancouver'], ['Park', 'park'], ['Tivoli', 'tivoli'],
]) {
  ok(resolve(nome) === esperado, `nome curto "${nome}" -> ${esperado}`);
}

// ------------------------------------------------- 4) plural que o Fernando usa (teste dos 20)
// O ERP grava "ROSA DE OURO" e ele escreve "Rosas de Ouro" (roteiro dos 20 cadastros).
ok(resolve('Rosas de Ouro') === 'rosa-de-ouro', '"Rosas de Ouro" (plural) -> rosa-de-ouro');
ok(resolve('Rosa de Ouro') === 'rosa-de-ouro', '"Rosa de Ouro" (singular) -> rosa-de-ouro');

// ------------------------------------------------- 5) COLISÃO SEGURA continua segura
// Adicionar alias não pode colar condomínios distintos. "SALTO GRANDE I" está contido em
// "SALTO GRANDE III" — se colidirem, uma multa sai com o regimento do prédio errado.
ok(resolve('Salto Grande I') === 'salto-grande-i', '"Salto Grande I" NÃO cai no III');
ok(resolve('Salto Grande III') === 'salto-grande-iii', '"Salto Grande III" NÃO cai no I');
ok(resolve('ASSOCIACAO JARDIM SALTO GRANDE I') === 'salto-grande-i', 'oficial do Salto Grande I');
ok(resolve('ASSOCIAÇÃO JARDIM SALTO GRANDE III') === 'salto-grande-iii', 'oficial do Salto Grande III');
// "Cedros" serve para 2 condomínios → tem de continuar recusando, não escolher um
ok(resolve('Cedros') === null, '"Cedros" continua AMBÍGUO (2 condomínios) — não escolhe sozinho');

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
