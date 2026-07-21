// test_clube.mjs — testes determinísticos (sem LLM) da tool consultar_clube (Clube NCS de Vantagens).
// Cobre: recuperação por nome exato, busca por categoria (múltiplas empresas), listagem sem termo,
// isolamento (não vaza campos internos da base) e anti-alucinação (empresa/termo fora da base).
import { consultar_clube, _reloadIndex } from '../src/clube.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

_reloadIndex();
let falhas = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK ' : 'FALHA'} ${msg}`); if (!cond) falhas++; };

const __d = path.dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(fs.readFileSync(path.join(__d, '..', 'data', 'clube', 'empresas.json'), 'utf8'));

// 1) Empresa conhecida — ALARM SYSTEM: desconto LITERAL + categoria + endereço + contato
const alarmFonte = base.empresas.find((e) => e.nome === 'ALARM SYSTEM');
const alarm = consultar_clube({ termo: 'ALARM SYSTEM' });
ok(alarm.encontrou, 'ALARM SYSTEM -> encontrou');
ok(alarm.empresas.length === 1 && alarm.empresas[0].nome === 'ALARM SYSTEM', 'ALARM SYSTEM -> 1 resultado exato');
ok(alarm.empresas[0].condicao === alarmFonte.condicao, 'ALARM SYSTEM -> condicao é o texto LITERAL da planilha (sem resumir)');
ok(alarm.empresas[0].categoria === 'Monitoramento e Portaria Remota', 'ALARM SYSTEM -> categoria correta');
ok(alarm.empresas[0].endereco === alarmFonte.endereco && alarm.empresas[0].contato === alarmFonte.contato,
  'ALARM SYSTEM -> endereço e contato batem com a fonte');

// 2) Busca parcial/case-insensitive por nome — "drogaven" (minúsculo)
const drogaven = consultar_clube({ termo: 'drogaven' });
ok(drogaven.encontrou && drogaven.empresas.length === 1 && drogaven.empresas[0].nome === 'DROGAVEN',
  '"drogaven" (minúsculo) -> resolve para DROGAVEN');
ok(drogaven.empresas[0].condicao === base.empresas.find((e) => e.nome === 'DROGAVEN').condicao,
  'DROGAVEN -> condicao literal (2 descontos, medicamento referencial e genérico)');

// 3) Busca por CATEGORIA — "Alimentação" deve trazer as empresas dessa categoria (mais de uma)
const alimentacao = consultar_clube({ termo: 'Alimentação' });
ok(alimentacao.encontrou && alimentacao.empresas.length >= 2, 'categoria "Alimentação" -> encontra 2+ empresas');
ok(alimentacao.empresas.every((e) => e.categoria === 'Alimentação'), 'categoria "Alimentação" -> todas as empresas retornadas são dessa categoria');
const nomesAlimentacao = alimentacao.empresas.map((e) => e.nome);
ok(nomesAlimentacao.includes('GV Carnes Nobres') && nomesAlimentacao.some((n) => /RUSTIC/i.test(n)),
  'categoria "Alimentação" -> inclui GV Carnes Nobres e a RUSTICÃO ESPETOS');

// 4) Sem termo — lista TODAS as empresas, resumida (nome + categoria, sem vazar desconto/endereço/contato)
const semTermo = consultar_clube({});
ok(semTermo.encontrou && semTermo.total === base.total, `sem termo -> lista completa (${base.total} empresas)`);
ok(Array.isArray(semTermo.lista) && semTermo.lista.length === base.total, 'sem termo -> lista[] com todas as empresas');
ok(semTermo.lista.every((e) => 'nome' in e && 'categoria' in e && !('condicao' in e) && !('endereco' in e) && !('contato' in e)),
  'sem termo -> resumo só com nome+categoria (não despeja o desconto de todo mundo de uma vez)');

// 5) Anti-alucinação: empresa/termo que NÃO existe na base
const fantasma = consultar_clube({ termo: 'Empresa Fantasma XPTO' });
ok(!fantasma.encontrou && fantasma.motivo === 'empresa_nao_encontrada', 'empresa inexistente -> empresa_nao_encontrada (não inventa)');
ok(!('empresas' in fantasma), 'empresa inexistente -> não retorna campo empresas (nada inventado)');

const categoriaFantasma = consultar_clube({ termo: 'Aeroporto Particular' });
ok(!categoriaFantasma.encontrou && categoriaFantasma.motivo === 'empresa_nao_encontrada', 'categoria inexistente -> empresa_nao_encontrada (não inventa)');

// 6) Isolamento: resposta não vaza campos internos da base (fonte/gerado_em/revisao_humana)
ok(!('fonte' in alarm) && !('gerado_em' in alarm) && !('revisao_humana' in alarm),
  'resposta não vaza metadados internos da base (fonte/gerado_em/revisao_humana)');

// 7) Varre TODAS as empresas da base: busca pelo próprio nome exato sempre encontra a empresa (sem inventar/perder nenhuma)
let naoAchou = 0;
for (const e of base.empresas) {
  const r = consultar_clube({ termo: e.nome });
  const achouEla = r.encontrou && r.empresas.some((x) => x.nome === e.nome && x.condicao === e.condicao);
  if (!achouEla) { naoAchou++; console.log(`   MISMATCH [${e.nome}] -> ${JSON.stringify(r)}`); }
}
ok(naoAchou === 0, `todas as ${base.empresas.length} empresas da base resolvem pelo próprio nome (achou ${naoAchou} mismatch)`);

// 8) Base vazia (índice recarregado de um arquivo inexistente) -> não quebra, não inventa
ok(base.empresas.length === 38, 'sanity: a base extraída tem 38 empresas (conferido contra a planilha)');

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
