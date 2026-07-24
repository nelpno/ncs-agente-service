// Card 2 do Resumo Financeiro — MANUTENÇÕES PROGRAMADAS. Determinístico, sem rede e sem segredo
// (roda no gate do CI). O dado real vem do espelho do painel admin (tabela manutencoes_agenda);
// aqui a fixture reproduz o formato do painel: matriz condomínio × mês, uma por categoria.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizarCelula, inferirAnos, linhasDoSnapshot, montarCardManutencoes,
  renderCardManutencoes, buscarManutencoes, rotuloQuando, mesNumero,
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

// ---- 2) ano de cada coluna (o painel só mostra o rótulo do mês) ----
const MESES = ['Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai'];
const cal = inferirAnos(MESES, '2026-07-24T22:42:58.624Z');
ok(cal.length === 12, 'calendário != 12 meses');
ok(cal[0].mes === 6 && cal[0].ano === 2026, 'Jun deveria ser jun/2026: ' + JSON.stringify(cal[0]));
ok(cal[6].mes === 12 && cal[6].ano === 2026, 'Dez deveria ser dez/2026: ' + JSON.stringify(cal[6]));
ok(cal[7].mes === 1 && cal[7].ano === 2027, 'Jan deveria virar 2027: ' + JSON.stringify(cal[7]));
ok(cal[11].mes === 5 && cal[11].ano === 2027, 'Mai deveria ser mai/2027: ' + JSON.stringify(cal[11]));
// janela que começa no ano anterior (captura em janeiro, janela abrindo em dezembro)
const calJan = inferirAnos(['Dez', 'Jan', 'Fev'], '2027-01-10T12:00:00Z');
ok(calJan[0].ano === 2026 && calJan[1].ano === 2027, 'janela virando o ano: ' + JSON.stringify(calJan));
ok(inferirAnos(['Xxx'], '2026-07-24T00:00:00Z').length === 0, 'rótulo inválido deveria devolver vazio');
ok(mesNumero('Fev') === 2 && mesNumero('zzz') === null, 'mesNumero');

// ---- 3) snapshot do painel → linhas ----
const snap = {
  capturado_em: '2026-07-24T22:42:58.624Z',
  meses: MESES,
  categorias: [{ id: '1001', nome: 'Extintores' }, { id: '4', nome: 'AVCB' }, { id: '2', nome: 'Teste' }],
  porCondo: {
    ATTUALE: {
      AVCB: { Fev: 'Dia 9' },
      Extintores: { Jul: 'Atrasado', Jun: 'Concluido', Out: 'Dia 1' },
      Teste: { Ago: 'Dia 3' },                       // categoria lixo — nunca entra
    },
    'CONDO FANTASMA': { AVCB: { Set: 'Dia 2' } },     // não casa com a API → descartado
  },
};
const idPorNome = { ATTUALE: 169 };
const { linhas, ignorados } = linhasDoSnapshot(snap, (n) => idPorNome[n] || null);
ok(linhas.length === 4, 'esperava 4 linhas — AVCB/Fev + Extintores Jul/Jun/Out (Teste e condo fantasma fora), veio ' + linhas.length);
ok(!linhas.some((l) => l.categoria === 'Teste'), 'categoria Teste (id 2) vazou pro espelho');
ok(ignorados.length === 1 && ignorados[0] === 'CONDO FANTASMA', 'condo sem match deveria ser reportado: ' + JSON.stringify(ignorados));
ok(!linhas.some((l) => !l.id_condominio), 'linha sem id_condominio (nunca chutar o condomínio)');
const avcb = linhas.find((l) => l.categoria === 'AVCB');
ok(avcb.ano === 2027 && avcb.mes === 2 && avcb.dia === 9, 'AVCB deveria ser 09/fev/2027: ' + JSON.stringify(avcb));
ok(linhas.every((l) => l.capturado_em === snap.capturado_em), 'capturado_em não propagado');

// ---- 4) card do mês do relatório ----
const card = montarCardManutencoes(linhas, { ano: 2026, mes: 10, capturadoEm: snap.capturado_em, hoje: '2026-07-25T12:00:00Z' });
ok(!!card, 'card veio null com linhas válidas');
ok(card.atrasadas.length === 1 && card.atrasadas[0].categoria === 'Extintores', 'atrasada não destacada: ' + JSON.stringify(card.atrasadas));
ok(card.noMes.length === 1 && card.noMes[0].quando === '01/out/2026', 'manutenção do mês do relatório errada: ' + JSON.stringify(card.noMes));
ok(card.proximas.length === 1 && card.proximas[0].categoria === 'AVCB', 'próxima errada: ' + JSON.stringify(card.proximas));
ok(!card.atrasadas.concat(card.noMes, card.proximas).some((i) => i.status === 'concluido' && i.mes !== 10), 'concluída de outro mês não deveria aparecer');
ok(card.omitidas === 0, 'omitidas deveria ser 0 sem truncagem');
ok(card.capturadoEmBR === '24/07/2026', 'data da captura em BR errada: ' + card.capturadoEmBR);
ok(card.desatualizado === false, 'captura de 1 dia marcada como desatualizada');
// staleness: mesma captura, lida 3 meses depois
const velho = montarCardManutencoes(linhas, { ano: 2026, mes: 10, capturadoEm: snap.capturado_em, hoje: '2026-10-25T12:00:00Z' });
ok(velho.desatualizado === true && velho.diasDesdeCaptura > 45, 'snapshot velho não sinalizado: ' + velho.diasDesdeCaptura);
// ordenação por proximidade
const ordenado = montarCardManutencoes(
  [
    { categoria: 'C', categoria_id: '9', ano: 2027, mes: 3, dia: 5, status: 'agendado' },
    { categoria: 'A', categoria_id: '8', ano: 2026, mes: 11, dia: 20, status: 'agendado' },
    { categoria: 'B', categoria_id: '7', ano: 2026, mes: 11, dia: 2, status: 'agendado' },
  ], { ano: 2026, mes: 10, capturadoEm: snap.capturado_em },
);
ok(ordenado.proximas.map((x) => x.categoria).join('') === 'BAC', 'próximas fora de ordem: ' + JSON.stringify(ordenado.proximas.map((x) => x.categoria)));
ok(montarCardManutencoes([], { ano: 2026, mes: 10 }) === null, 'sem linhas deveria devolver null');
ok(montarCardManutencoes(null, { ano: 2026, mes: 10 }) === null, 'linhas null deveria devolver null');
// mês do relatório ANTERIOR a tudo: nada "no mês", mas as futuras aparecem
const passado = montarCardManutencoes(linhas, { ano: 2026, mes: 1, capturadoEm: snap.capturado_em });
ok(passado.noMes.length === 0 && passado.proximas.length >= 1, 'relatório de mês antigo deveria listar as próximas');
// TRUNCAGEM não é silenciosa: sobra vira contagem explícita (o informativo é de 1 página)
const muitas = [...Array(7)].map((_, i) => ({ categoria: 'Cat' + i, categoria_id: String(100 + i), ano: 2027, mes: 1, dia: i + 1, status: 'agendado' }));
const cortado = montarCardManutencoes(muitas, { ano: 2026, mes: 10, capturadoEm: snap.capturado_em });
ok(cortado.proximas.length === 6 && cortado.omitidas === 1, 'truncagem errada: ' + JSON.stringify({ n: cortado.proximas.length, omitidas: cortado.omitidas }));
ok(/Outra manutenção programada não coube/.test(renderCardManutencoes(cortado)), 'HTML não avisou o que ficou de fora (corte silencioso)');
// teto de LINHAS respeitado mesmo com as 3 seções cheias (o informativo é de 1 página)
const cheio = montarCardManutencoes(
  [...Array(4)].map((_, i) => ({ categoria: 'Atr' + i, categoria_id: 'a' + i, ano: 2026, mes: 7, dia: null, status: 'atrasado' }))
    .concat([...Array(4)].map((_, i) => ({ categoria: 'Mes' + i, categoria_id: 'm' + i, ano: 2026, mes: 10, dia: i + 1, status: 'agendado' })))
    .concat([...Array(4)].map((_, i) => ({ categoria: 'Prox' + i, categoria_id: 'p' + i, ano: 2027, mes: 1, dia: i + 1, status: 'agendado' }))),
  { ano: 2026, mes: 10, capturadoEm: snap.capturado_em });
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
const linhasSb = linhas.map((l) => ({ categoria: l.categoria, categoria_id: l.categoria_id, ano: l.ano, mes: l.mes, dia: l.dia, status: l.status, capturado_em: l.capturado_em }));
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
