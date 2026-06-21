// test_garantidora.mjs — testes determinísticos (sem LLM, sem rede) da consulta de garantidora.
// Cobre: match por id, match por nome (condo cego ao token), tipo total x allure, e ausência (condo normal). Exit 1 em falha.
import { consultar_garantidora, _matchGarantidora } from '../src/garantidora.mjs';

let falhas = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK ' : 'FALHA'} ${msg}`); if (!cond) falhas++; };

// 1) Flores (id 182) -> CONDINVEST, tipo total
const flores = consultar_garantidora({ id_condominio: 182 });
ok(flores.tem && flores.tipo === 'total' && flores.garantidora.nome === 'CONDINVEST' && /condinvest/i.test(flores.garantidora.email),
  `Flores(182) -> garantidora total CONDINVEST (wpp ${flores.garantidora?.whatsapp})`);

// 2) id como string também casa (vem assim das tools)
ok(consultar_garantidora({ id_condominio: '176' }).garantidora?.nome === 'BV GARANTIA', 'id "176" (string) -> BV GARANTIA');

// 3) Allure (id 62) -> exceção: tipo allure (boleto normal a NCS gera)
const allure = consultar_garantidora({ id_condominio: 62 });
ok(allure.tem && allure.tipo === 'allure' && allure.garantidora.nome === 'INADIMPLENCIA ZERO', 'Allure(62) -> tipo allure / INADIMPLENCIA ZERO');

// 4) Vistas do Botânico: SEM id (cego ao token) -> casa por nome
const vistas = _matchGarantidora({ nome: 'Vistas do Botânico - Cedros' });
ok(vistas && vistas.garantidora === 'CONDINVEST' && vistas.tipo === 'total', 'Vistas do Botânico (só nome) -> CONDINVEST total');

// 5) Condomínio SEM garantidora (Lume = 179) -> tem:false (não inventa)
ok(consultar_garantidora({ id_condominio: 179 }).tem === false, 'Lume(179) -> sem garantidora (tem:false)');
ok(consultar_garantidora({}).tem === false, 'sem id/nome -> tem:false (não assume)');

// 6) Total Garantidora (Pairás 184) -> e-mail e whatsapp presentes (e-mail confirmado pelo Fernando 19/06)
const pairas = consultar_garantidora({ id_condominio: 184 });
ok(pairas.garantidora?.nome === 'TOTAL GARANTIDORA' && pairas.garantidora.email === 'contato@totalgarantidora.com.br' && pairas.garantidora.whatsapp,
  'Pairás(184) -> TOTAL GARANTIDORA, e-mail e whatsapp presentes');

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
