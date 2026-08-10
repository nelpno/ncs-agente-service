// test_apostrofo_nome.mjs — o apóstrofo UNE a palavra; ele não pode separar o nome do condomínio.
//
// POR QUE ISTO EXISTE (vídeo do Fernando, 10/08/2026): "cobrança L'Harmonie" no Estagiário respondia
// "Não consta aqui o parâmetro de cobrança do L'Harmonie" — com o condomínio na base o tempo todo.
// O `normNome` tratava o apóstrofo como pontuação: "L'Harmonie" virava "l harmonie" (DOIS tokens) e
// o ERP grava "LHARMONIE" (UM token), então nenhum dos 4 degraus do `_filtrarCondos` casava.
//
// ⚠️ E as nossas bases escrevem o mesmo condomínio de três formas: "LHARMONIE" (cobrança),
// "L’ HARMONIE" (mudança — apóstrofo tipográfico U+2019 seguido de ESPAÇO) e "L'Harmonie" (a
// equipe). Um fix que só removesse o apóstrofo consertaria a cobrança e QUEBRARIA a mudança, que
// hoje funciona. Por isso o apóstrofo absorve o espaço seguinte: as três convergem.
//
// Uso: node test/test_apostrofo_nome.mjs

import { normNome, tokensNome } from '../gerador/src/match-nome.mjs';
import { _filtrarCondos } from '../src/superlogica.mjs';
import { consultar_parametros_cobranca } from '../src/cobranca_parametros.mjs';
import { consultar_regra_mudanca } from '../src/mudanca.mjs';

let failures = 0;
function assert(condition, label) {
  if (condition) console.log('  OK  ', label);
  else { console.error('  FAIL', label); failures++; }
}

console.log('\n=== test_apostrofo_nome.mjs ===\n');

// 1. As três grafias reais convergem para a MESMA forma normalizada.
{
  // Só as formas COM apóstrofo (e a já colada) convergem — "L Harmonie", com espaço e sem
  // apóstrofo, segue sendo dois tokens de propósito: colar toda letra solta à palavra seguinte
  // seria uma regra ampla demais, e quem resolve esse caso é o matcher da tool (ver item 3).
  const formas = ["L'Harmonie", 'L’ HARMONIE', 'LHARMONIE', 'l’harmonie', "l'harmonie"];
  const norms = formas.map(normNome);
  assert(new Set(norms).size === 1, `as ${formas.length} grafias com apóstrofo viram uma só (${JSON.stringify([...new Set(norms)])})`);
  assert(norms[0] === 'lharmonie', `forma canônica "lharmonie" (veio "${norms[0]}")`);
  assert(tokensNome("L'Harmonie").length === 1, 'apóstrofo não parte o nome em dois tokens');
}

// 2. O filtro de condomínios acha o L'Harmonie escrito como a equipe escreve.
{
  const base = [{ id: 1, nome: 'LHARMONIE' }, { id: 2, nome: 'CONDOMINIO VALE SUPREMO' }, { id: 3, nome: 'SPAZIO ABBOCATO' }];
  for (const q of ["L'Harmonie", 'L’ HARMONIE', 'LHARMONIE', 'lharmonie']) {
    const hits = _filtrarCondos(base, q);
    assert(hits.length === 1 && hits[0].id === 1, `_filtrarCondos("${q}") acha só o LHARMONIE (achou ${hits.length})`);
  }
}

// 3. Ponta a ponta nas DUAS bases que escrevem o nome diferente (é o caso real do vídeo).
{
  const cob = consultar_parametros_cobranca({ condominio: "L'Harmonie" });
  assert(cob.encontrou === true, `cobrança do L'Harmonie é encontrada (motivo: ${cob.motivo || '—'})`);

  const mud = consultar_regra_mudanca({ condominio: "L'Harmonie" });
  assert(mud.encontrou === true, `regra de mudança do L'Harmonie continua sendo encontrada (motivo: ${mud.motivo || '—'})`);
  // ⚠️ Este é o controle que reprovou a 1ª versão do fix: a mudança JÁ funcionava com apóstrofo
  // (a base tem "L’ HARMONIE") e teria parado de funcionar.
  const mudSemAp = consultar_regra_mudanca({ condominio: 'L Harmonie' });
  assert(mudSemAp.encontrou === true, 'e também sem o apóstrofo');
}

// 4. CONTROLE NEGATIVO — nome SEM apóstrofo passa intocado pela normalização.
{
  const casos = ['Vale Supremo', 'Spazio Abbocato', 'Rosas de Ouro', 'Salto Grande I', 'CONDOMINIO RESIDENCIAL VANCOUVER', 'Vitta Ipê Roxo'];
  const esperado = { 'Vale Supremo': 'vale supremo', 'Spazio Abbocato': 'spazio abbocato', 'Rosas de Ouro': 'rosas de ouro', 'Salto Grande I': 'salto grande i', 'CONDOMINIO RESIDENCIAL VANCOUVER': 'condominio residencial vancouver', 'Vitta Ipê Roxo': 'vitta ipe roxo' };
  let iguais = 0;
  for (const c of casos) if (normNome(c) === esperado[c]) iguais++;
  assert(iguais === casos.length, `${iguais}/${casos.length} nomes sem apóstrofo normalizam exatamente como antes`);
}

// 5. CONTROLE — a colisão legítima continua colidindo (o fix não pode "resolver" ambiguidade).
{
  const base = [{ id: 1, nome: 'ASSOCIACAO ... SALTO GRANDE - CEDROS DO CAMPO' }, { id: 2, nome: 'VISTAS DO BOTANICO - CEDROS' }];
  assert(_filtrarCondos(base, 'Cedros').length === 2, '"Cedros" segue ambíguo entre os dois (ninguém escolhe no chute)');
}

console.log(failures === 0 ? '\n✅ todos passaram\n' : `\n❌ ${failures} falha(s)\n`);
process.exit(failures === 0 ? 0 : 1);
