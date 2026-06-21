// test_portaria.mjs — testes determinísticos (sem LLM) da tool consultar_sistema_portaria.
// Cobre: recuperação por nome exato/parcial, flag usa_shielder, sistema não-Shielder, "Não Identificado",
// isolamento (não assume condo) e anti-alucinação (condo fora da base). Exit 1 em qualquer falha (regressão).
import { consultar_sistema_portaria, _reloadIndex } from '../src/portaria.mjs';

_reloadIndex();
let falhas = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK ' : 'FALHA'} ${msg}`); if (!cond) falhas++; };

// 1) Shielder (nome exato) — Lume
const lume = consultar_sistema_portaria({ condominio: 'Lume' });
ok(lume.encontrou && lume.usa_shielder && lume.sistema_conhecido, `Lume -> Shielder (usa_shielder=true), sistema="${lume.sistema}"`);

// 2) Outro sistema — Amarige usa GatWay (NÃO é Shielder)
const amarige = consultar_sistema_portaria({ condominio: 'Amarige' });
ok(amarige.encontrou && !amarige.usa_shielder && /gatway/i.test(amarige.sistema), `Amarige -> GatWay (usa_shielder=false)`);

// 3) Synnus — Aracaju
const aracaju = consultar_sistema_portaria({ condominio: 'aracaju' });
ok(aracaju.encontrou && !aracaju.usa_shielder && /synnus/i.test(aracaju.sistema), 'Aracaju -> Synnus (não-Shielder)');

// 4) Não Identificado — Flores: encontrou, mas sistema_conhecido=false (Ana confirma com a equipe)
const flores = consultar_sistema_portaria({ condominio: 'Flores' });
ok(flores.encontrou && !flores.sistema_conhecido, 'Flores -> encontrou mas sistema_conhecido=false (não orienta às cegas)');

// 5) match parcial — "Vitta Ipê Roxo" casa com "Ipê Roxo"
const ipe = consultar_sistema_portaria({ condominio: 'Vitta Ipê Roxo' });
ok(ipe.encontrou && ipe.usa_shielder, 'Vitta Ipê Roxo -> casa por nome parcial (Shielder)');

// 6) isolamento: sem condomínio NÃO assume nenhum
const semCondo = consultar_sistema_portaria({});
ok(!semCondo.encontrou && semCondo.motivo === 'condominio_nao_informado', 'sem condomínio -> condominio_nao_informado (não assume)');

// 7) anti-alucinação: condomínio fora da base
const fora = consultar_sistema_portaria({ condominio: 'Edifício Inexistente XPTO' });
ok(!fora.encontrou && fora.motivo === 'condominio_sem_sistema', 'condo fora da base -> condominio_sem_sistema (não inventa)');
ok(fora.nota_geral && /financeira/i.test(fora.nota_geral), 'condo fora da base -> ainda devolve nota_geral (financeiro é pelo Gruvi)');

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
