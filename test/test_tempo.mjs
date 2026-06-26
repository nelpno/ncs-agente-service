// test_tempo.mjs — determinístico, sem LLM. Valida agoraContextoTemporal nas fronteiras.
// Brasília = UTC-3 o ano todo (Brasil sem horário de verão desde 2019), então o mapeamento é fixo.
import assert from 'node:assert';
import { agoraContextoTemporal } from '../src/tempo.mjs';

const casos = [
  // ISO UTC,                 saudação,     estado     // -> hora Brasília (dia)
  ['2026-06-25T11:00:00Z', 'Bom dia',   'ABERTO'],  // 08:00 qui (abre)
  ['2026-06-25T16:00:00Z', 'Boa tarde', 'ABERTO'],  // 13:00 qui
  ['2026-06-25T20:44:00Z', 'Boa tarde', 'ABERTO'],  // 17:44 qui (último minuto aberto)
  ['2026-06-25T20:50:00Z', 'Boa tarde', 'FECHADO'], // 17:50 qui (passou das 17:45)
  ['2026-06-25T23:00:00Z', 'Boa noite', 'FECHADO'], // 20:00 qui
  ['2026-06-25T10:30:00Z', 'Bom dia',   'FECHADO'], // 07:30 qui (antes das 8h)
  ['2026-06-27T16:00:00Z', 'Boa tarde', 'FECHADO'], // 13:00 sáb (fim de semana)
  ['2026-06-25T02:00:00Z', 'Boa noite', 'FECHADO'], // 23:00 qua (noite)
];

let ok = 0;
for (const [iso, saud, estado] of casos) {
  const s = agoraContextoTemporal(new Date(iso));
  assert(s.includes(`"${saud}"`), `${iso}: esperava saudação ${saud}\n  got: ${s}`);
  assert(s.includes(`está ${estado}`), `${iso}: esperava ${estado}\n  got: ${s}`);
  ok++;
}
console.log(`test_tempo: ${ok}/${casos.length} OK`);
