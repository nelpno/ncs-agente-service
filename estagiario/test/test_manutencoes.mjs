// Card 2 do Resumo Financeiro — MANUTENÇÕES PROGRAMADAS. Determinístico, sem rede e sem segredo
// (roda no gate do CI). O dado real vem do espelho do painel admin (tabela manutencoes_agenda);
// aqui a fixture reproduz o formato do painel: matriz condomínio × mês, uma por categoria.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizarCelula, montarCardManutencoes, renderCardManutencoes,
  buscarManutencoes, rotuloQuando,
  derivarCelula, janelaPainel, parseDataSL, linhasDosRegistros,
} from '../../gerador-relatorio-contas/src/manutencoes.mjs';
import { montarResumoFinanceiro, renderHTMLResumo } from '../../gerador-relatorio-contas/src/resumo-financeiro.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  ✗ FALHOU:', msg); } }

// ---- 1) célula do painel ----
ok(JSON.stringify(normalizarCelula('Dia 9')) === JSON.stringify({ status: 'agendado', dia: 9 }), 'Dia 9 mal parseado');
ok(normalizarCelula('Concluido').status === 'concluido' && normalizarCelula('Concluído').status === 'concluido', 'Concluido/Concluído');
ok(normalizarCelula('Atrasado').status === 'atrasado', 'Atrasado');
ok(normalizarCelula('Agendado').status === 'agendado' && normalizarCelula('Agendado').dia === null, 'Agendado sem dia');
ok(normalizarCelula('') === null && normalizarCelula(null) === null && normalizarCelula('   ') === null, 'célula vazia deveria ser null');
ok(normalizarCelula('Listar tudo') === null, 'texto desconhecido vira null (nunca inventa status)');

// ---- 3) registro da API interna -> celula do painel -> linhas ----
// A regra de derivacao foi conferida contra as 266 celulas capturadas do HTML do painel em
// 24/07/2026 (266/266 identicas). Estes casos sao os 5 ramos dela; se o painel mudar, isto cai.
const HOJE = '2026-07-24T12:00:00Z';
const MM = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const reg = (dt, meses, extra = {}) => ({
  id_condominio_cond: '169', st_fantasia_cond: 'ATTUALE', st_nome_cond: 'CONDOMINIO ATTUALE',
  id_manutencoes_mt: '1001', st_nome_mt: 'Extintores', dt_manutencao_mc: dt,
  ...Object.fromEntries(MM.map((m) => ['fl_' + m + '_mc', meses.includes(m) ? '1' : ''])),
  ...extra,
});
ok(JSON.stringify(parseDataSL('07/01/2027 00:00:00')) === JSON.stringify({ mes: 7, dia: 1, ano: 2027 }), 'parseDataSL (MM/DD/AAAA)');
ok(parseDataSL('') === null && parseDataSL('ontem') === null, 'parseDataSL de lixo deveria ser null');
// mes SEM recorrencia -> sem celula
ok(derivarCelula(reg('02/09/2027', ['fev']), { ano: 2026, mes: 10 }, HOJE) === null, 'mes fora da recorrencia deveria ser null');
// futuro: so o mes DA DATA leva o dia; os outros meses de recorrencia = "Agendado"
ok(derivarCelula(reg('02/09/2027', ['fev']), { ano: 2027, mes: 2 }, HOJE) === 'Dia 9', 'futuro no mes da data deveria ser Dia 9');
ok(derivarCelula(reg('07/22/2026', ['jan', 'abr', 'jul', 'out']), { ano: 2026, mes: 10 }, HOJE) === 'Agendado', 'outro mes de recorrencia deveria ser Agendado');
// o painel casa o dia pelo MES, ignorando o ano da data (caso ACACIAS: dt de 2025, coluna de 2026)
ok(derivarCelula(reg('12/30/2025', ['jan', 'dez']), { ano: 2026, mes: 12 }, HOJE) === 'Dia 30', 'dia deveria valer p/ o mes, mesmo com data de ano anterior');
// passado: data rolou pra frente = feita; senao atrasada
ok(derivarCelula(reg('01/30/2027', ['jun', 'jan']), { ano: 2026, mes: 6 }, HOJE) === 'Concluido', 'mes passado com data futura deveria ser Concluido');
ok(derivarCelula(reg('06/10/2026', ['jun']), { ano: 2026, mes: 6 }, HOJE) === 'Atrasado', 'mes passado com data nao-rolada deveria ser Atrasado');
// mes corrente
ok(derivarCelula(reg('07/01/2027', ['jul']), { ano: 2026, mes: 7 }, HOJE) === 'Concluido', 'mes corrente com data ja rolada deveria ser Concluido');
ok(derivarCelula(reg('07/28/2026', ['jul']), { ano: 2026, mes: 7 }, HOJE) === 'Dia 28', 'mes corrente com dia a frente deveria ser Dia 28');
ok(derivarCelula(reg('07/02/2026', ['jul']), { ano: 2026, mes: 7 }, HOJE) === 'Atrasado', 'mes corrente com dia passado deveria ser Atrasado');
// sem data definida -> Agendado (nunca inventa dia)
ok(derivarCelula(reg('', ['set']), { ano: 2026, mes: 9 }, HOJE) === 'Agendado', 'sem data deveria ser Agendado');

// janela do painel: 12 meses comecando no mes ANTERIOR
const jan12 = janelaPainel(HOJE);
ok(jan12.length === 12 && jan12[0].mes === 6 && jan12[0].ano === 2026, 'janela deveria comecar em jun/2026: ' + JSON.stringify(jan12[0]));
ok(jan12[11].mes === 5 && jan12[11].ano === 2027, 'janela deveria terminar em mai/2027: ' + JSON.stringify(jan12[11]));
const jvira = janelaPainel('2027-01-10T12:00:00Z');
ok(jvira[0].mes === 12 && jvira[0].ano === 2026, 'janela em janeiro deveria abrir em dez do ano anterior: ' + JSON.stringify(jvira[0]));

// registros -> linhas (id vem da FONTE; categoria "Teste" fora; registro sem id descartado e reportado)
const { linhas, semId } = linhasDosRegistros([
  reg('02/09/2027', ['fev'], { id_manutencoes_mt: '4', st_nome_mt: 'AVCB' }),
  reg('01/30/2027', ['jun', 'jan'], { id_manutencoes_mt: '1003', st_nome_mt: 'Seguros' }),
  reg('08/03/2026', ['ago'], { id_manutencoes_mt: '2', st_nome_mt: 'Teste' }),
  reg('09/02/2026', ['set'], { id_condominio_cond: '', st_fantasia_cond: 'FANTASMA' }),
], { capturadoEm: HOJE, hoje: HOJE });
ok(!linhas.some((l) => l.categoria === 'Teste'), 'categoria Teste (id 2) vazou pro espelho');
ok(!linhas.some((l) => !l.id_condominio), 'linha sem id_condominio');
ok(linhas.every((l) => l.id_condominio === 169), 'id_condominio deveria vir da fonte (169)');
ok(semId.length === 1 && semId[0] === 'FANTASMA', 'registro sem id deveria ser reportado: ' + JSON.stringify(semId));
const avcb = linhas.find((l) => l.categoria === 'AVCB');
ok(avcb && avcb.ano === 2027 && avcb.mes === 2 && avcb.dia === 9 && avcb.status === 'agendado', 'AVCB deveria ser 09/fev/2027 agendado: ' + JSON.stringify(avcb));
const segJun = linhas.find((l) => l.categoria === 'Seguros' && l.mes === 6);
ok(segJun && segJun.status === 'concluido', 'Seguros/jun deveria estar concluido: ' + JSON.stringify(segJun));
ok(linhas.every((l) => l.capturado_em === HOJE && l.valor_raw), 'capturado_em/valor_raw ausentes');
// as linhas alimentam o card sem traducao no meio
const cardDoSync = montarCardManutencoes(linhas, { ano: 2026, mes: 6, capturadoEm: HOJE, hoje: HOJE });
ok(!!cardDoSync && cardDoSync.noMes.some((x) => x.situacao === 'Concluida' || x.situacao === 'Concluída'), 'card a partir das linhas do sync: ' + JSON.stringify(cardDoSync && cardDoSync.noMes));

// ---- 4) card do mês do relatório ----
// mesmas 4 celulas do Attuale de 24/07 (AVCB/fev, Extintores jul atrasado, jun concluido, out dia 1)
const CAP = '2026-07-24T22:42:58.624Z';
const cel = (categoria, categoria_id, ano, mes, dia, status) => ({ categoria, categoria_id, ano, mes, dia, status, capturado_em: CAP });
const linhasAttuale = [
  cel('AVCB', '4', 2027, 2, 9, 'agendado'),
  cel('Extintores', '1001', 2026, 7, null, 'atrasado'),
  cel('Extintores', '1001', 2026, 6, null, 'concluido'),
  cel('Extintores', '1001', 2026, 10, 1, 'agendado'),
];
const card = montarCardManutencoes(linhasAttuale, { ano: 2026, mes: 10, capturadoEm: CAP, hoje: '2026-07-25T12:00:00Z' });
ok(!!card, 'card veio null com linhas válidas');
ok(card.atrasadas.length === 1 && card.atrasadas[0].categoria === 'Extintores', 'atrasada não destacada: ' + JSON.stringify(card.atrasadas));
ok(card.noMes.length === 1 && card.noMes[0].quando === '01/out/2026', 'manutenção do mês do relatório errada: ' + JSON.stringify(card.noMes));
ok(card.proximas.length === 1 && card.proximas[0].categoria === 'AVCB', 'próxima errada: ' + JSON.stringify(card.proximas));
ok(!card.atrasadas.concat(card.noMes, card.proximas).some((i) => i.status === 'concluido' && i.mes !== 10), 'concluída de outro mês não deveria aparecer');
ok(card.omitidas === 0, 'omitidas deveria ser 0 sem truncagem');
ok(card.capturadoEmBR === '24/07/2026', 'data da captura em BR errada: ' + card.capturadoEmBR);
ok(card.desatualizado === false, 'captura de 1 dia marcada como desatualizada');
// staleness: mesma captura, lida 3 meses depois
const velho = montarCardManutencoes(linhasAttuale, { ano: 2026, mes: 10, capturadoEm: CAP, hoje: '2026-10-25T12:00:00Z' });
ok(velho.desatualizado === true && velho.diasDesdeCaptura > 45, 'snapshot velho não sinalizado: ' + velho.diasDesdeCaptura);
// ordenação por proximidade
const ordenado = montarCardManutencoes(
  [
    { categoria: 'C', categoria_id: '9', ano: 2027, mes: 3, dia: 5, status: 'agendado' },
    { categoria: 'A', categoria_id: '8', ano: 2026, mes: 11, dia: 20, status: 'agendado' },
    { categoria: 'B', categoria_id: '7', ano: 2026, mes: 11, dia: 2, status: 'agendado' },
  ], { ano: 2026, mes: 10, capturadoEm: CAP },
);
ok(ordenado.proximas.map((x) => x.categoria).join('') === 'BAC', 'próximas fora de ordem: ' + JSON.stringify(ordenado.proximas.map((x) => x.categoria)));
ok(montarCardManutencoes([], { ano: 2026, mes: 10 }) === null, 'sem linhas deveria devolver null');
ok(montarCardManutencoes(null, { ano: 2026, mes: 10 }) === null, 'linhas null deveria devolver null');
// mês do relatório ANTERIOR a tudo: nada "no mês", mas as futuras aparecem
const passado = montarCardManutencoes(linhasAttuale, { ano: 2026, mes: 1, capturadoEm: CAP });
ok(passado.noMes.length === 0 && passado.proximas.length >= 1, 'relatório de mês antigo deveria listar as próximas');
// TRUNCAGEM não é silenciosa: sobra vira contagem explícita (o informativo é de 1 página)
const muitas = [...Array(7)].map((_, i) => ({ categoria: 'Cat' + i, categoria_id: String(100 + i), ano: 2027, mes: 1, dia: i + 1, status: 'agendado' }));
const cortado = montarCardManutencoes(muitas, { ano: 2026, mes: 10, capturadoEm: CAP });
ok(cortado.proximas.length === 6 && cortado.omitidas === 1, 'truncagem errada: ' + JSON.stringify({ n: cortado.proximas.length, omitidas: cortado.omitidas }));
ok(/Outra manutenção programada não coube/.test(renderCardManutencoes(cortado)), 'HTML não avisou o que ficou de fora (corte silencioso)');
// teto de LINHAS respeitado mesmo com as 3 seções cheias (o informativo é de 1 página)
const cheio = montarCardManutencoes(
  [...Array(4)].map((_, i) => ({ categoria: 'Atr' + i, categoria_id: 'a' + i, ano: 2026, mes: 7, dia: null, status: 'atrasado' }))
    .concat([...Array(4)].map((_, i) => ({ categoria: 'Mes' + i, categoria_id: 'm' + i, ano: 2026, mes: 10, dia: i + 1, status: 'agendado' })))
    .concat([...Array(4)].map((_, i) => ({ categoria: 'Prox' + i, categoria_id: 'p' + i, ano: 2027, mes: 1, dia: i + 1, status: 'agendado' }))),
  { ano: 2026, mes: 10, capturadoEm: CAP });
const linhasCard = cheio.atrasadas.length + cheio.noMes.length + cheio.proximas.length;
ok(linhasCard === 6 && cheio.omitidas === 6, 'teto de 6 linhas furado: ' + JSON.stringify({ linhasCard, omitidas: cheio.omitidas }));
ok(cheio.atrasadas.length === 3 && cheio.noMes.length === 3 && cheio.proximas.length === 0, 'prioridade atraso > mês > próximas quebrada: ' + JSON.stringify({ a: cheio.atrasadas.length, m: cheio.noMes.length, p: cheio.proximas.length }));
ok(rotuloQuando({ ano: 2027, mes: 2, dia: 9 }) === '09/fev/2027' && rotuloQuando({ ano: 2027, mes: 2 }) === 'fev/2027', 'rótulo de data');

// ---- 5) HTML do card ----
const html = renderCardManutencoes(card);
ok(/MANUTEN/.test(html) && /Extintores/.test(html) && /AVCB/.test(html), 'HTML do card sem as manutenções');
ok(/Em atraso/.test(html) && /class="atr"/.test(html), 'HTML sem destaque de atraso');
// o item em atraso vem ANTES dos demais (a tabela é única; a ordem é o destaque)
ok(html.indexOf('Em atraso') < html.indexOf('Agendada'), 'atraso deveria vir primeiro na tabela');
ok((html.match(/<tr/g) || []).length === 3, 'esperava 1 linha por manutenção (3), veio ' + (html.match(/<tr/g) || []).length);
ok(/Cronograma conforme o sistema em 24\/07\/2026/.test(html), 'HTML sem a data da captura (staleness)');
ok(renderCardManutencoes(null) === '', 'card null deveria render string vazia');
ok(!/undefined|NaN/.test(html), 'HTML com undefined/NaN: ' + html.slice(0, 200));

// ---- 6) leitura do espelho (fetch injetado; sem rede) ----
const OLD = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY };
delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
ok(await buscarManutencoes(169, { ano: 2026, mes: 10 }) === null, 'Supabase desligado deveria devolver null');
process.env.SUPABASE_URL = 'https://exemplo.supabase.co'; process.env.SUPABASE_SERVICE_KEY = 'chave-de-teste';
const linhasSb = linhasAttuale.map((l) => ({ categoria: l.categoria, categoria_id: l.categoria_id, ano: l.ano, mes: l.mes, dia: l.dia, status: l.status, capturado_em: l.capturado_em }));
const cardSb = await buscarManutencoes(169, { ano: 2026, mes: 10 }, { fetch: async () => ({ ok: true, json: async () => linhasSb }) });
ok(!!cardSb && cardSb.atrasadas.length === 1, 'card do espelho não montou: ' + JSON.stringify(cardSb));
ok(await buscarManutencoes(169, { ano: 2026, mes: 10 }, { fetch: async () => ({ ok: false, status: 500, text: async () => 'erro' }) }) === null, 'erro HTTP deveria virar null');
ok(await buscarManutencoes(169, { ano: 2026, mes: 10 }, { fetch: async () => { throw new Error('rede'); } }) === null, 'exceção de rede deveria virar null');
ok(await buscarManutencoes(169, { ano: 2026, mes: 10 }, { fetch: async () => ({ ok: true, json: async () => [] }) }) === null, 'condomínio sem cronograma deveria virar null');
ok(await buscarManutencoes(null, { ano: 2026, mes: 10 }, { fetch: async () => { throw new Error('não deveria chamar'); } }) === null, 'sem id não deveria consultar');

// ---- 7) integração com o Resumo (o card NUNCA é caminho crítico) ----
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'resumo-attuale-jun2026.json'), 'utf8'));
const depsBase = {
  balancete: async (id, dtIni) => ({ nomeplanocontas: 'ATTUALE', itens: /^05/.test(String(dtIni)) ? fx.balanceteAnterior : fx.balancete }),
  caixa: async () => fx.caixa,
  inadimplencia: async () => ({ qtd: 12, total: 9731.02, unidades: [] }),
};
const comCard = await montarResumoFinanceiro({ idCondominio: 169, ano: 2026, mes: 6, nomeCondominio: 'ATTUALE' },
  { ...depsBase, manutencoes: async () => card });
ok(!!comCard.manutencoes && /MANUTEN/.test(renderHTMLResumo(comCard)), 'Resumo não trouxe o Card 2');
ok(comCard.receitaAjustada === 103937.37, 'Card 2 mexeu nos números do Card 1');

const semCard = await montarResumoFinanceiro({ idCondominio: 169, ano: 2026, mes: 6, nomeCondominio: 'ATTUALE' },
  { ...depsBase, manutencoes: async () => null });
ok(semCard.manutencoes === null && !/MANUTEN/.test(renderHTMLResumo(semCard)), 'sem cronograma deveria sair sem o card');

const comErro = await montarResumoFinanceiro({ idCondominio: 169, ano: 2026, mes: 6, nomeCondominio: 'ATTUALE' },
  { ...depsBase, manutencoes: async () => { throw new Error('supabase fora'); } });
ok(comErro.manutencoes === null && comErro.receitaAjustada === 103937.37, 'erro no Card 2 deveria degradar, não quebrar o Resumo');

if (OLD.url) process.env.SUPABASE_URL = OLD.url; else delete process.env.SUPABASE_URL;
if (OLD.key) process.env.SUPABASE_SERVICE_KEY = OLD.key; else delete process.env.SUPABASE_SERVICE_KEY;

console.log(`\ntest_manutencoes: ${pass} OK, ${fail} FALHOU`);
if (fail) process.exit(1);
