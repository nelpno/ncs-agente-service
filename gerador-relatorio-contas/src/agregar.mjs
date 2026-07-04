// Camada DETERMINÍSTICA (sem LLM): transforma o snapshot cru da Superlógica no modelo do relatório.
// TODO número do relatório nasce aqui — o LLM só redige texto SOBRE estes números (anti-alucinação).
const MESES = ['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const nivel = conta => String(conta).split('.').length;
const ehReceita = conta => String(conta).startsWith('1');
const ehDespesa = conta => String(conta).startsWith('2');

// itens de nível 2 (X.Y) de uma natureza — as "categorias" que o síndico entende
function categorias(itens, filtro) {
  return itens
    .filter(i => filtro(i.conta) && nivel(i.conta) === 2)
    .map(i => ({ conta: i.conta, descricao: i.descricao.replace(/^\d[\d.]*\s*/, '').trim(), valor: i.valor }))
    .sort((a, b) => b.valor - a.valor);
}

function topo(itens, filtro) {
  const t = itens.find(i => nivel(i.conta) === 1 && filtro(i.conta));
  return t ? t.valor : 0;
}

// Previsto (R$) para uma conta e seus filhos no mês alvo.
// O orçamento pode estar num nível mais fundo que o balancete (ex.: balancete "2.5" ↔ orçamento "2.5.1","2.5.2"),
// então somamos por PREFIXO, no nível mais raso que tem valor (evita contar subtotal + filhos duas vezes).
function previstoDeConta(orcamento, conta, mes) {
  const C = String(conta);
  const under = orcamento.filter(r => (r.conta === C || r.conta.startsWith(C + '.')) && r.valorMes?.[mes] !== undefined);
  if (!under.length) return null;
  const minDepth = Math.min(...under.map(r => r.conta.split('.').length));
  return under.filter(r => r.conta.split('.').length === minDepth).reduce((s, r) => s + r.valorMes[mes], 0);
}

function aggCaixa(caixa) {
  let saldoInicial = 0, entradas = 0, saidas = 0, movs = 0;
  for (const row of caixa) {
    if (row.saldoinicialconta !== undefined && row.vl_valor_mov === undefined) {
      saldoInicial += parseFloat(row.saldoinicialconta) || 0;
    } else if (row.vl_valor_mov !== undefined) {
      const v = parseFloat(row.vl_valor_mov) || 0;
      movs++;
      if (v >= 0) entradas += v; else saidas += -v;
    }
  }
  return { saldoInicial, entradas, saidas, saldoFinal: saldoInicial + entradas - saidas, movimentos: movs };
}

/**
 * @param snap  snapshot { balancete, orcamento, caixa, contas, inadimplencia }
 * @param opts  { ano, mes, condominio, prevBalancete? , alertaPct? }
 */
export function agregar(snap, opts) {
  const { ano, mes } = opts;
  const alertaPct = opts.alertaPct ?? 5; // desvio ≥5% vira alerta
  const itens = snap.balancete?.itens || [];

  const receitasTotal = topo(itens, ehReceita) || categorias(itens, ehReceita).reduce((s, c) => s + c.valor, 0);
  const despesasTotal = topo(itens, ehDespesa) || categorias(itens, ehDespesa).reduce((s, c) => s + c.valor, 0);
  const resultado = receitasTotal - despesasTotal;

  const orc = snap.orcamento || [];
  const previstoReceitas = previstoDeConta(orc, '1', mes);
  const previstoDespesas = previstoDeConta(orc, '2', mes);

  // comparativo previsto × realizado por categoria de DESPESA (o que gera "estourou o orçamento")
  const orcamentoDespesas = categorias(itens, ehDespesa).map(c => {
    const prev = previstoDeConta(orc, c.conta, mes);
    const desvio = prev != null ? c.valor - prev : null;
    const desvioPct = prev ? (desvio / prev) * 100 : null;
    return { ...c, previsto: prev ?? null, realizado: c.valor, desvio, desvioPct };
  });
  const alertas = orcamentoDespesas
    .filter(c => c.desvioPct != null && c.desvioPct >= alertaPct && c.desvio > 0)
    .sort((a, b) => b.desvioPct - a.desvioPct)
    .map(c => ({ categoria: c.descricao, previsto: c.previsto, realizado: c.realizado, excedentePct: c.desvioPct, excedente: c.desvio }));

  const cx = aggCaixa(snap.caixa || []);
  const inad = snap.inadimplencia || { qtd: 0, total: 0, unidades: [] };

  // comparativo com o mês anterior (se fornecido)
  let comparativo = null;
  if (opts.prevBalancete) {
    const pit = opts.prevBalancete.itens || [];
    const pRec = topo(pit, ehReceita), pDesp = topo(pit, ehDespesa);
    comparativo = {
      receitas: { atual: receitasTotal, anterior: pRec, varPct: pRec ? ((receitasTotal - pRec) / pRec) * 100 : null },
      despesas: { atual: despesasTotal, anterior: pDesp, varPct: pDesp ? ((despesasTotal - pDesp) / pDesp) * 100 : null },
      resultado: { atual: resultado, anterior: pRec - pDesp },
    };
  }

  const temOrcamento = (orc.length > 0) && (previstoReceitas != null || previstoDespesas != null);

  return {
    condominio: opts.condominio || {},
    periodo: { ano, mes, mesNome: MESES[mes], label: `${MESES[mes]} de ${ano}` },
    temOrcamento,
    receitas: { total: receitasTotal, previsto: previstoReceitas, categorias: categorias(itens, ehReceita) },
    despesas: { total: despesasTotal, previsto: previstoDespesas, categorias: categorias(itens, ehDespesa) },
    resultado: {
      valor: resultado,
      tipo: resultado >= 0 ? 'superavit' : 'deficit',
      previsto: (previstoReceitas != null && previstoDespesas != null) ? previstoReceitas - previstoDespesas : null,
    },
    orcamentoDespesas,
    alertas,
    caixa: cx,
    inadimplencia: { qtd: inad.qtd, total: inad.total, unidades: (inad.unidades || []).map(u => ({ unidade: u.unidade, valor: u.valor, juridico: u.juridico })) },
    comparativo,
    _fontes: ['balancetes/index', 'orcamentos/index', 'caixa/index', 'inadimplencia/index'],
  };
}

export { MESES };
