// Teste do retriever da BASE INSTITUCIONAL GLOBAL (sem LLM): valida que as seções/fontes certas sobem por pergunta.
// Roda: node test/test_base_geral.mjs  (cwd = automacoes/agente-service). Sem outbound, sem PII.
import { consultar_base_geral } from '../src/base_geral.mjs';

const casos = [
  { q: 'Quais descontos eu tenho como morador?', espera: /clube/i },
  { q: 'Como funciona o Clube NCS?', espera: /clube/i },
  { q: 'Tem desconto em pizzaria?', espera: /clube|pitcho|pizz/i },
  { q: 'O Grupo NCS faz terceirizacao de portaria e limpeza?', espera: /terceiriz|portaria|limpeza|mao/i },
  { q: 'O que e a Academia do Sindico?', espera: /academia|projet/i },
  { q: 'Que servicos a administradora oferece?', espera: /administra|servi|portf/i },
  { q: 'Onde fica o Grupo NCS / sobre a empresa?', espera: /empresa|sobre/i },
  { q: 'Como usar o desconto no delivery?', espera: /clube|delivery|utilizar/i },
  { q: 'Qual a cotacao do dolar hoje?', espera: null }, // fora da base institucional -> pouco/nada relevante
];

let ok = 0;
for (const { q, espera } of casos) {
  const r = consultar_base_geral({ pergunta: q });
  const fontes = (r.trechos || []).map((t) => t.fonte);
  const top = fontes[0] || '(nenhum)';
  const acerto = espera ? fontes.some((f) => espera.test(f) || espera.test((r.trechos.find((t) => t.fonte === f)?.texto) || '')) : true;
  if (acerto) ok++;
  console.log(`${acerto ? 'OK ' : 'XX '} "${q}"`);
  console.log(`     encontrou=${r.encontrou} | top: ${top}`);
  if (espera && !acerto) console.log(`     >>> esperava casar ${espera} em: ${fontes.join(' | ')}`);
}
console.log(`\n${ok}/${casos.length} recuperacoes no alvo`);

// comportamento de "so responde do que tiver" (anti-alucinacao) e ausencia de filtro por condominio
console.log('\n--- bordas / anti-alucinacao ---');
const vazia = consultar_base_geral({ pergunta: '' });
console.log(`pergunta vazia       -> encontrou=${vazia.encontrou} motivo=${vazia.motivo} (esperado: false / pergunta_vazia)`);
const semNada = consultar_base_geral({ pergunta: 'xyzqwk plutonio reator nuclear' });
console.log(`pergunta sem match   -> encontrou=${semNada.encontrou} motivo=${semNada.motivo} (esperado: false / nada_relevante_na_base_geral)`);
const global = consultar_base_geral({ pergunta: 'Clube NCS' });
console.log(`SEM condominio (global) -> encontrou=${global.encontrou} top=${global.trechos?.[0]?.fonte} (a base e institucional, nao pede condominio)`);

// exit code util pra CI: passa se >= 8/9 dos casos e as bordas batem
const bordasOk = !vazia.encontrou && !semNada.encontrou && global.encontrou;
const pass = ok >= 8 && bordasOk;
console.log(`\n${pass ? 'PASS' : 'FAIL'} (casos ${ok}/${casos.length}, bordas ${bordasOk ? 'OK' : 'X'})`);
process.exit(pass ? 0 : 1);
