// test_cobranca.mjs — testes determinísticos (sem LLM, sem rede) do roteamento de cobrança por escritório.
// Cobre: match por id e por nome, ausência (não inventa), ordem garantidora>escritório>gerência, e o sinal de handoff.
// Fonte: data/escritorios-cobranca.json (48 condos) + garantidoras.json. Exit 1 em falha.
import { _matchEscritorio, escritorioDe, roteamentoCobranca, sinalCobranca } from '../src/cobranca.mjs';

let falhas = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK ' : 'FALHA'} ${msg}`); if (!cond) falhas++; };

// 1) match por id (preferido) — Acácias I (112) -> ISABELA OSTE (extra e judicial)
const ac = escritorioDe({ id_condominio: '112' });
ok(ac.tem && ac.extrajudicial?.nome === 'ISABELA OSTE' && /99722-4239/.test(ac.extrajudicial.whatsapp) && ac.judicial?.nome === 'ISABELA OSTE',
  `Acácias(112) -> extra/judicial ISABELA OSTE (wpp ${ac.extrajudicial?.whatsapp})`);

// 2) id como number também casa; extra != judicial — Altos do Jaraguá (41): GRUPO NCS extra, EVERTON judicial
const al = escritorioDe({ id_condominio: 41 });
ok(al.tem && al.extrajudicial?.nome === 'GRUPO NCS' && al.judicial?.nome === 'EVERTON MARCHESE',
  `Altos(41) -> extra GRUPO NCS / judicial EVERTON MARCHESE`);

// 3) match por nome (sem id) — nome_superlogica "ALTOS DO JARAGUÁ"
ok(_matchEscritorio({ nome: 'Altos do Jaraguá' })?.id === '41', 'nome "Altos do Jaraguá" -> id 41');

// 4) ausência: id inexistente e sem nome -> tem:false (NÃO inventa escritório)
ok(escritorioDe({ id_condominio: '99999' }).tem === false, 'id inexistente -> tem:false');
ok(escritorioDe({}).tem === false, 'sem id/nome -> tem:false (não assume)');

// 5) roteamento: GARANTIDORA tem prioridade sobre escritório — Flores (182) é garantidora total
ok(roteamentoCobranca({ id_condominio: 182 }).destino === 'garantidora', 'Flores(182) -> destino garantidora (prioridade)');

// 6) roteamento: condo normal -> destino escritório, com extra/judicial
const r41 = roteamentoCobranca({ id_condominio: 41 });
ok(r41.destino === 'escritorio' && r41.extrajudicial?.nome === 'GRUPO NCS', 'Altos(41) -> destino escritorio (GRUPO NCS)');

// 7) roteamento: condo desconhecido sem garantidora -> destino gerencia (fallback seguro)
ok(roteamentoCobranca({ id_condominio: '99999' }).destino === 'gerencia', 'desconhecido -> destino gerencia');

// 8) sinal de handoff: motivo NÃO-cobrança -> null (não enriquece à toa)
ok(sinalCobranca('rh', { id_condominio: 41 }) === null, 'motivo rh -> sinal null');

// 9) sinal de handoff: motivo de cobrança -> tag determinística + roteamento embutido
const s = sinalCobranca('boleto_mais_30_dias', { id_condominio: 41 });
ok(s && s.tag === 'cobranca-grupo-ncs' && s.roteamento?.destino === 'escritorio', `cobrança(41) -> tag ${s?.tag}`);

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
