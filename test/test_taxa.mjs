// test_taxa.mjs — testes determinísticos (sem LLM) da tool consultar_taxa_condominial.
// Cobre: recuperação por nome exato/parcial/alias, campos gas/agua/internet corretos para condos conhecidos,
// isolamento (não assume condo, não vaza dado de outro condo), e anti-alucinação (condo fora da base).
import { consultar_taxa_condominial, _reloadIndex } from '../src/taxa.mjs';

_reloadIndex();
let falhas = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK ' : 'FALHA'} ${msg}`); if (!cond) falhas++; };

// 1) ALLURE — gás incluso (Ultragás) + internet com provedores
const allure = consultar_taxa_condominial({ condominio: 'Allure' });
ok(allure.encontrou && allure.condominio === 'ALLURE', 'Allure -> encontrou');
ok(allure.itens.gas.incluso === true && allure.itens.gas.empresa === 'Ultragás', 'Allure -> gás incluso, empresa Ultragás');
ok(Array.isArray(allure.itens.internet) && allure.itens.internet.includes('Vivo') && allure.itens.internet.includes('Claro') && allure.itens.internet.includes('Desktop'),
  'Allure -> internet com Vivo/Claro/Desktop');
ok(/gás incluso/i.test(allure.resumo) && /ultrag[aá]s/i.test(allure.resumo) && /internet/i.test(allure.resumo), 'Allure -> resumo cita gás e internet');

// 2) ABBOCATO — só gás incluso (Néctar), sem água, sem internet cadastrada
const abbocato = consultar_taxa_condominial({ condominio: 'abbocato' });
ok(abbocato.encontrou && abbocato.itens.gas.incluso === true && abbocato.itens.gas.empresa === 'Néctar', 'Abbocato -> gás incluso (Néctar)');
ok(abbocato.itens.agua.incluso === false, 'Abbocato -> água NÃO inclusa');
ok(abbocato.itens.internet.length === 0, 'Abbocato -> sem provedores de internet cadastrados');

// 3) ACÁCIAS (I) e MOOVE — nada incluso
for (const [q, nomeEsperado] of [['Acácias', 'ACÁCIAS'], ['moove', 'MOOVE']]) {
  const r = consultar_taxa_condominial({ condominio: q });
  ok(r.encontrou && r.condominio === nomeEsperado, `${q} -> encontrou ${nomeEsperado}`);
  ok(r.itens.gas.incluso === false && r.itens.agua.incluso === false, `${q} -> nada incluso (gás e água false)`);
  ok(/g[aá]s n[aã]o incluso/i.test(r.resumo) && /[aá]gua n[aã]o inclusa/i.test(r.resumo), `${q} -> resumo confirma nada incluso`);
}

// 4) BARBIERI — água E gás inclusos
const barbieri = consultar_taxa_condominial({ condominio: 'Barbieri' });
ok(barbieri.encontrou && barbieri.itens.gas.incluso === true && barbieri.itens.agua.incluso === true, 'Barbieri -> gás E água inclusos');

// 5) alias/match parcial: "Studio 5" (dígito) e "Studio Five" -> FIVE (mesmo padrão de mudanca.mjs)
for (const q of ['Studio 5', 'studio five', 'FIVE']) {
  const r = consultar_taxa_condominial({ condominio: q });
  ok(r.encontrou && r.condominio === 'FIVE', `"${q}" -> resolve para FIVE`);
}

// 6) isolamento: sem condomínio NÃO assume nenhum
const semCondo = consultar_taxa_condominial({});
ok(!semCondo.encontrou && semCondo.motivo === 'condominio_nao_informado', 'sem condomínio -> condominio_nao_informado (não assume)');

// 7) anti-alucinação: condomínio fora da base
const fora = consultar_taxa_condominial({ condominio: 'xyz' });
ok(!fora.encontrou && fora.motivo === 'condominio_sem_dado_taxa', 'condo "xyz" fora da base -> condominio_sem_dado_taxa (não inventa)');
const fora2 = consultar_taxa_condominial({ condominio: 'Edifício Inexistente XPTO' });
ok(!fora2.encontrou && fora2.motivo === 'condominio_sem_dado_taxa', 'condo inexistente -> condominio_sem_dado_taxa (não inventa)');

// 8) isolamento: a resposta de um condomínio NUNCA vaza dado de outro (compara Allure x Abbocato x Barbieri)
ok(allure.itens.gas.empresa !== abbocato.itens.gas.empresa || allure.condominio !== abbocato.condominio,
  'Allure e Abbocato têm respostas distintas (sem contaminação cruzada)');
ok(!('obs' in allure) && !('revisar_slug' in allure) && ('itens' in allure),
  'resposta não vaza campos internos (obs/revisar_slug) da base de dados');
ok(JSON.stringify(allure.itens) !== JSON.stringify(barbieri.itens), 'Allure e Barbieri -> itens diferentes (sem vazamento)');

// 9) varre TODOS os condomínios da base: cada um resolve pelo próprio nome e nunca retorna o nome de outro
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __d = path.dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(fs.readFileSync(path.join(__d, '..', 'data', 'taxa', 'taxa-inclusa.json'), 'utf8'));
let cruzados = 0;
for (const c of base.condominios) {
  const r = consultar_taxa_condominial({ condominio: c.nome });
  if (!r.encontrou || r.condominio !== c.nome) { cruzados++; console.log(`   MISMATCH [${c.nome}] -> ${JSON.stringify(r)}`); }
}
ok(cruzados === 0, `todos os ${base.condominios.length} condomínios da base resolvem para o próprio nome (achou ${cruzados} mismatch)`);
ok(base.condominios.filter((c) => c.revisar_slug).length === 3, 'base tem exatamente 3 itens marcados revisar_slug (cocisa-3, mario-de-andrade, salto-grande-cedros)');

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
