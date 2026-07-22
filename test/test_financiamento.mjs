// test_financiamento.mjs — guard de FINANCIAMENTO externo (ex.: reforma via 6P Bank no Vancouver).
// Condomínio/unidade com dívida de financiamento que NÃO aparece no Superlógica → a Ana não pode
// declarar quitação (CND) nem cravar "em dia". Determinístico (sem LLM, sem rede). Exit 1 em falha.
import { consultar_financiamento, _matchFinanciamento } from '../src/financiamento.mjs';

let falhas = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK ' : 'FALHA'} ${msg}`); if (!cond) falhas++; };

// 1) Vancouver (id 178) — ponte escopo 'condominio' → afeta QUALQUER unidade
const v1 = consultar_financiamento({ id_condominio: 178, id_unidade: 441 });
ok(v1.afeta === true && v1.instituicao === '6P Bank', `Vancouver(178) un441 -> afeta:true / 6P Bank (canal ${v1.canal ? 'ok' : 'FALTA'})`);
const v2 = consultar_financiamento({ id_condominio: '178' }); // id string, sem unidade
ok(v2.afeta === true, 'Vancouver id "178" string sem unidade -> afeta:true (escopo condominio)');

// 2) Condomínio SEM financiamento externo (Lume = 179) → afeta:false (não inventa)
ok(consultar_financiamento({ id_condominio: 179, id_unidade: 9999 }).afeta === false, 'Lume(179) -> afeta:false');
ok(consultar_financiamento({}).afeta === false, 'sem id -> afeta:false (não assume)');

// 3) Modo PRECISO (escopo 'unidades') — garante que a estrutura de amanhã funciona:
//    afeta só os id_unidade listados; as demais unidades do mesmo condo ficam livres.
const dbUnidades = {
  instituicoes: { '6P Bank': { canal: 'a equipe confirma com a 6P Bank' } },
  condominios: { '178': { nome: 'Vancouver', instituicao: '6P Bank', escopo: 'unidades', unidades: ['441', '502'], aviso: 'saldo de reforma 6P' } },
};
ok(_matchFinanciamento({ id_condominio: 178, id_unidade: 441 }, dbUnidades).afeta === true, 'escopo unidades: apto listado (441) -> afeta:true');
ok(_matchFinanciamento({ id_condominio: 178, id_unidade: 999 }, dbUnidades).afeta === false, 'escopo unidades: apto NÃO listado (999) -> afeta:false');
ok(_matchFinanciamento({ id_condominio: 178 }, dbUnidades).afeta === false, 'escopo unidades: sem id_unidade -> afeta:false (não bloqueia o condo todo)');

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
