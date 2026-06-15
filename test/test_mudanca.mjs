// test_mudanca.mjs — testes determinísticos (sem LLM) da tool consultar_regra_mudanca.
// Cobre: recuperação por nome exato/parcial, isolamento (não assume condo), anti-alucinação (condo fora da base),
// e presença das regras gerais. Exit 1 em qualquer falha (regressão).
import { consultar_regra_mudanca, _reloadIndex } from '../src/mudanca.mjs';

_reloadIndex();
let falhas = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK ' : 'FALHA'} ${msg}`); if (!cond) falhas++; };

// 1) Lume (nome exato)
const lume = consultar_regra_mudanca({ condominio: 'Lume' });
ok(lume.encontrou && /SEXTA/i.test(lume.horario) && /SHIELDER/i.test(lume.procedimento),
  `Lume -> encontrou, horário+procedimento ("${(lume.horario || '').slice(0, 40)}…")`);
ok(lume.regras_gerais && /não tem taxa/i.test(lume.regras_gerais.taxa) && /24 horas/i.test(lume.regras_gerais.antecedencia),
  'Lume -> regras_gerais (sem taxa + 24h) presentes');

// 2) case-insensitive / parcial
const vanc = consultar_regra_mudanca({ condominio: 'vancouver' });
ok(vanc.encontrou && vanc.condominio === 'VANCOUVER', 'vancouver (minúsculo) -> VANCOUVER');
const park = consultar_regra_mudanca({ condominio: 'PARQUE DOS TRILHOS' });
ok(park.encontrou && /TRILHOS/i.test(park.condominio), 'Parque dos Trilhos -> encontrou');

// 3) isolamento: sem condomínio NÃO assume nenhum
const semCondo = consultar_regra_mudanca({});
ok(!semCondo.encontrou && semCondo.motivo === 'condominio_nao_informado', 'sem condomínio -> condominio_nao_informado (não assume)');

// 4) anti-alucinação: condomínio fora da base
const fora = consultar_regra_mudanca({ condominio: 'Edifício Inexistente XPTO' });
ok(!fora.encontrou && fora.motivo === 'condominio_sem_regra', 'condo fora da base -> condominio_sem_regra (não inventa)');
ok(fora.regras_gerais && fora.regras_gerais.como_agendar, 'condo fora da base -> ainda devolve regras_gerais (Ana orienta o agendamento)');

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
