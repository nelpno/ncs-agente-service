// Relatório de PERÍODO consolidado (ex.: jan→mai) — o equivalente ao "11A" da Superlógica.
// Busca o balancete de CADA mês do intervalo, agrega mês a mês E acumulado (determinístico),
// e monta um doc único com tabela mês-a-mês + gráficos + categorias acumuladas.
// Mesmos helpers do relatório mensal (agregar.mjs) — nada é recalculado à mão.
import * as SL from './superlogica-financeiro.mjs';
import { categorias, topo, ehReceita, ehDespesa, previstoDeConta, aggCaixa, MESES } from './agregar.mjs';
import { renderHTMLPeriodo } from './template-periodo.mjs';
import { textoExecutivoPeriodo } from './texto-executivo.mjs';

function aggBalancete(bal) {
  const itens = bal?.itens || [];
  const catR = categorias(itens, ehReceita), catD = categorias(itens, ehDespesa);
  const receitas = topo(itens, ehReceita) || catR.reduce((s, c) => s + c.valor, 0);
  const despesas = topo(itens, ehDespesa) || catD.reduce((s, c) => s + c.valor, 0);
  return { receitas, despesas, resultado: receitas - despesas, catR, catD };
}

// soma as categorias (mesmo nível 2) ao longo dos meses → acumulado por categoria
function acumularCategorias(mesesAgg, campo) {
  const map = new Map();
  for (const a of mesesAgg) for (const c of a[campo]) {
    const cur = map.get(c.conta) || { conta: c.conta, descricao: c.descricao, valor: 0 };
    cur.valor += c.valor;
    if (!cur.descricao && c.descricao) cur.descricao = c.descricao;
    map.set(c.conta, cur);
  }
  return [...map.values()].sort((a, b) => b.valor - a.valor);
}

/**
 * montarRelatorioPeriodo({ idCondominio, ano, mesInicio, mesFim, nome, chat?, log? }) → { modelo, texto, html }
 * Números 100% Superlógica. Previsto só quando o condo é o default confiável (mesmo gate do mensal).
 */
export async function montarRelatorioPeriodo({ idCondominio, ano, mesInicio, mesFim, nome, chat, log, alertaPct = 5 } = {}) {
  const meses = [];
  for (let m = mesInicio; m <= mesFim; m++) meses.push(m);

  const balancetes = await Promise.all(meses.map(m => {
    const { dtInicio, dtFim } = SL.periodoMes(ano, m);
    return SL.balancete(idCondominio, dtInicio, dtFim).catch(() => ({ itens: [] }));
  }));
  const pIni = SL.periodoMes(ano, mesInicio), pFim = SL.periodoMes(ano, mesFim);
  const [caixaRaw, inad, orc] = await Promise.all([
    SL.caixa(idCondominio, pIni.dtInicio, pFim.dtFim).catch(() => []),
    SL.inadimplenciaResumo(idCondominio).catch(() => ({ qtd: 0, total: 0, unidades: [] })),
    SL.orcamento(idCondominio).catch(() => []),
  ]);

  const mesesAgg = balancetes.map((b, i) => {
    const a = aggBalancete(b);
    return { mes: meses[i], mesNome: MESES[meses[i]], receitas: a.receitas, despesas: a.despesas, resultado: a.resultado, catR: a.catR, catD: a.catD };
  });

  const receitasTotal = mesesAgg.reduce((s, m) => s + m.receitas, 0);
  const despesasTotal = mesesAgg.reduce((s, m) => s + m.despesas, 0);
  const resultado = receitasTotal - despesasTotal;
  const nMeses = meses.length;

  const catReceita = acumularCategorias(mesesAgg, 'catR');
  const catDespesa = acumularCategorias(mesesAgg, 'catD');

  // previsto do período = soma do previsto de cada mês (só condo default; senão orc=[] → null)
  const somaPrev = conta => {
    let tot = null;
    for (const m of meses) { const p = previstoDeConta(orc, conta, m); if (p != null) tot = (tot || 0) + p; }
    return tot;
  };
  const previstoReceitas = orc.length ? somaPrev('1') : null;
  const previstoDespesas = orc.length ? somaPrev('2') : null;

  const orcamentoDespesas = catDespesa.map(c => {
    const prev = orc.length ? somaPrev(c.conta) : null;
    const desvio = prev != null ? c.valor - prev : null;
    const desvioPct = prev ? (desvio / prev) * 100 : null;
    return { ...c, previsto: prev ?? null, realizado: c.valor, desvio, desvioPct };
  });
  const alertas = orcamentoDespesas
    .filter(c => c.desvioPct != null && c.desvioPct >= alertaPct && c.desvio > 0)
    .sort((a, b) => b.desvioPct - a.desvioPct)
    .map(c => ({ categoria: c.descricao, previsto: c.previsto, realizado: c.realizado, excedentePct: c.desvioPct, excedente: c.desvio }));

  const caixa = aggCaixa(caixaRaw);
  const temOrcamento = orc.length > 0 && (previstoReceitas != null || previstoDespesas != null);

  const modelo = {
    condominio: { nome, id: idCondominio },
    periodo: {
      ano, mesInicio, mesFim, nMeses,
      mesInicioNome: MESES[mesInicio], mesFimNome: MESES[mesFim],
      label: mesInicio === mesFim ? `${MESES[mesInicio]} de ${ano}` : `${MESES[mesInicio]} a ${MESES[mesFim]} de ${ano}`,
    },
    temOrcamento,
    porMes: mesesAgg.map(m => ({ mes: m.mes, mesNome: m.mesNome, receitas: m.receitas, despesas: m.despesas, resultado: m.resultado })),
    receitas: { total: receitasTotal, previsto: previstoReceitas, media: receitasTotal / nMeses, categorias: catReceita },
    despesas: { total: despesasTotal, previsto: previstoDespesas, media: despesasTotal / nMeses, categorias: catDespesa },
    resultado: {
      valor: resultado, tipo: resultado >= 0 ? 'superavit' : 'deficit', media: resultado / nMeses,
      previsto: (previstoReceitas != null && previstoDespesas != null) ? previstoReceitas - previstoDespesas : null,
      mesesPositivos: mesesAgg.filter(m => m.resultado >= 0).length,
      mesesNegativos: mesesAgg.filter(m => m.resultado < 0).length,
    },
    orcamentoDespesas, alertas, caixa,
    inadimplencia: { qtd: inad.qtd, total: inad.total, unidades: (inad.unidades || []).map(u => ({ unidade: u.unidade, valor: u.valor, juridico: u.juridico })) },
    _fontes: ['balancetes/index (por mês)', 'caixa/index (período)', 'inadimplencia/index (posição atual)'],
  };
  const texto = await textoExecutivoPeriodo(modelo, { chat, log });
  const html = renderHTMLPeriodo(modelo, texto);
  return { modelo, texto, html };
}
