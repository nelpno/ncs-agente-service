// test_mudanca.mjs — testes determinísticos (sem LLM) da tool consultar_regra_mudanca.
// Cobre: recuperação por nome exato/parcial, isolamento (não assume condo), anti-alucinação (condo fora da base),
// e presença das regras gerais. Exit 1 em qualquer falha (regressão).
import { consultar_regra_mudanca, _reloadIndex } from '../src/mudanca.mjs';

_reloadIndex();
let falhas = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK ' : 'FALHA'} ${msg}`); if (!cond) falhas++; };

// 1) Lume (nome exato) — horário sanitizado (sem procedimento interno exposto)
const lume = consultar_regra_mudanca({ condominio: 'Lume' });
ok(lume.encontrou && /SEXTA/i.test(lume.horario) && !('procedimento' in lume),
  `Lume -> encontrou, horário sanitizado e SEM campo procedimento ("${(lume.horario || '').slice(0, 40)}…")`);
ok(lume.regras_gerais && /não tem taxa/i.test(lume.regras_gerais.taxa) && /72 horas/i.test(lume.regras_gerais.antecedencia),
  'Lume -> regras_gerais (sem taxa + 72h) presentes');
ok(/comunica|portaria|zeladoria/i.test(lume.regras_gerais.quem_comunica || ''),
  'Lume -> regras_gerais.quem_comunica deixa claro que a NCS avisa a portaria/zeladoria');

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

// 5) 🔴 REGRESSÃO ANTI-VAZAMENTO (Fernando 28/06): NENHUM condomínio pode devolver, no conteúdo voltado ao morador
// (horario + regras_condominio), o procedimento INTERNO do adm (avisar zeladora/portaria, cadastrar em sistema, e-mail/WhatsApp).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __d = path.dirname(fileURLToPath(import.meta.url));
const condos = JSON.parse(fs.readFileSync(path.join(__d, '..', 'data', 'mudanca', 'horarios-mudanca.json'), 'utf8')).condominios;
const HARD_LEAK = /zelador[ae]|portaria|whats|e-?mail|shielder|s[ií]ndic|alarm|grupo do|enviar a|cadastrar no|informativo/i;
let vazamentos = 0;
for (const c of condos) {
  const r = consultar_regra_mudanca({ condominio: c.nome });
  let blob = (r.horario || '') + ' || ' + (r.regras_condominio || []).join(' | ');
  blob = blob.replace(/almo[çc]o do zelador/ig, ''); // "almoço do zelador" é horário benigno, não rota interna
  if (HARD_LEAK.test(blob)) { vazamentos++; console.log(`   VAZOU [${c.nome}]: ${blob.slice(0, 120)}`); }
}
ok(vazamentos === 0, `anti-vazamento: 0 dos ${condos.length} condôminos expõem procedimento interno ao morador (achou ${vazamentos})`);

// 6) 🔴 REGRESSÃO match "Studio 5" / "Studio Five" → FIVE (o Fernando digitou "Studio 5"; antes dava encontrou:false)
for (const q of ['Studio 5', 'studio five', 'FIVE']) {
  const r = consultar_regra_mudanca({ condominio: q });
  ok(r.encontrou && r.condominio === 'FIVE', `"${q}" -> resolve para FIVE`);
}

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
