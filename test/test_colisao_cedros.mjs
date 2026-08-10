// test_colisao_cedros.mjs — o Cedros do Campo não pode receber a regra do Vistas do Botânico.
//
// POR QUE ISTO EXISTE: as bases de mudança, taxa e portaria tinham um registro chamado só "CEDROS".
// Como o matcher casa por palavras significativas, a consulta explícita "Cedros do Campo" — que é
// OUTRO condomínio (`sg-cedros-do-campo`, sem regra cadastrada) — casava e recebia a regra do
// vizinho: horário de mudança, o que está incluso na taxa e o sistema de portaria, todos do prédio
// errado. Era a única colisão das 3 tools sobre os 55 condomínios (varredura de 09/08).
//
// O Fernando respondeu em 10/08 de quem é o registro: **Vistas do Botânico - Cedros**. Renomeado,
// "Cedros do Campo" passa a não achar nada — que é a resposta certa: nós não temos a regra dele, e
// dizer "não temos" é recuperável; entregar a regra de outro condomínio não é.
//
// ⚠️ Limitação conhecida e deliberada: quem disser apenas "Cedros" ainda cai no Vistas do Botânico
// em mudança/portaria (na taxa fica ambíguo, porque lá existe também o SALTO GRANDE CEDROS). Só se
// resolve quando o Cedros do Campo tiver registro próprio nas bases.
//
// Uso: node test/test_colisao_cedros.mjs

import { consultar_regra_mudanca } from '../src/mudanca.mjs';
import { consultar_taxa_condominial } from '../src/taxa.mjs';
import { consultar_sistema_portaria } from '../src/portaria.mjs';

let failures = 0;
function assert(condition, label) {
  if (condition) console.log('  OK  ', label);
  else { console.error('  FAIL', label); failures++; }
}

console.log('\n=== test_colisao_cedros.mjs ===\n');

const TOOLS = [
  ['mudança', (c) => consultar_regra_mudanca({ condominio: c })],
  ['taxa', (c) => consultar_taxa_condominial({ condominio: c })],
  ['portaria', (c) => consultar_sistema_portaria({ condominio: c })],
];

// 1. O defeito: o nome EXPLÍCITO do outro condomínio não pode achar o registro do Vistas.
for (const [nome, fn] of TOOLS) {
  const r = fn('Cedros do Campo');
  assert(r.encontrou === false, `${nome}: "Cedros do Campo" NÃO recebe a regra do vizinho (veio ${r.condominio || r.motivo})`);
}

// 2. CONTROLE POSITIVO — o dono do registro continua sendo atendido, com e sem acento/hífen.
for (const [nome, fn] of TOOLS) {
  for (const q of ['Vistas do Botanico - Cedros', 'Vistas do Botânico Cedros']) {
    const r = fn(q);
    assert(r.encontrou === true && /VISTAS DO BOTANICO/i.test(r.condominio || ''), `${nome}: "${q}" acha o registro certo`);
  }
}

// 3. CONTROLE — o rename não pode ter derrubado um condomínio vizinho qualquer.
{
  const r = consultar_regra_mudanca({ condominio: 'Lume' });
  assert(r.encontrou === true, 'mudança: o Lume (controle) continua funcionando');
}

console.log(failures === 0 ? '\n✅ todos passaram\n' : `\n❌ ${failures} falha(s)\n`);
process.exit(failures === 0 ? 0 : 1);
