// Template HTML branded NCS do relatório de PERÍODO (consolidado) e da ANÁLISE/RECOMENDAÇÃO.
// Todos os números vêm do modelo; texto executivo/recomendação é a única parte de LLM.
import { svgReceitaDespesaMensal, svgPrevistoRealizado } from './graficos.mjs';

const NAVY = '#1a3a5c', GOLD = '#c9a227', INK = '#243141', MUT = '#6b7684', LINE = '#e4e8ee', BG = '#f6f8fb';
const brl = v => v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = v => v == null ? '—' : (v >= 0 ? '+' : '') + Number(v).toFixed(1) + '%';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const paras = t => esc(t).split(/\n{1,}/).filter(Boolean).map(p => `<p>${p}</p>`).join('');

const STYLE = `
  @page { size: A4; margin: 14mm 12mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: ${INK}; margin: 0; font-size: 12px; line-height: 1.45; }
  .head { display:flex; justify-content:space-between; align-items:flex-end; border-bottom: 3px solid ${GOLD}; padding-bottom: 10px; }
  .brand { font-size: 22px; font-weight: 800; color: ${NAVY}; letter-spacing: .5px; }
  .brand small { color: ${GOLD}; }
  .doc-t { text-align:right; }
  .doc-t .t1 { font-size: 15px; font-weight: 700; color: ${NAVY}; }
  .doc-t .t2 { color: ${MUT}; font-size: 12px; }
  h2 { font-size: 12.5px; text-transform: uppercase; letter-spacing: .6px; color: ${NAVY}; margin: 20px 0 8px; border-left: 4px solid ${GOLD}; padding-left: 8px; }
  .cards { display:flex; gap: 10px; margin-top: 14px; }
  .card { flex:1; background:${BG}; border:1px solid ${LINE}; border-radius: 8px; padding: 12px 14px; }
  .card-t { font-size: 10.5px; text-transform:uppercase; letter-spacing:.5px; color:${MUT}; }
  .card-v { font-size: 18px; font-weight: 800; color:${NAVY}; margin-top: 4px; }
  .card .prev { font-size: 10.5px; color:${MUT}; margin-top:2px; }
  .card.res .card-v { color:var(--rescolor); }
  .execbox { background:#fbfcfe; border:1px solid ${LINE}; border-left:4px solid ${NAVY}; border-radius:6px; padding: 12px 16px; margin-top: 8px; }
  .execbox p { margin: 0 0 8px; } .execbox p:last-child { margin: 0; }
  .recbox { background:#fbfaf4; border:1px solid #ecdfb6; border-left:4px solid ${GOLD}; border-radius:6px; padding: 12px 16px; margin-top: 8px; }
  .recbox p { margin: 0 0 8px; } .recbox p:last-child { margin: 0; }
  .chartbox { border:1px solid ${LINE}; border-radius:8px; padding:10px 12px 4px; margin-top:8px; page-break-inside:avoid; }
  table { width:100%; border-collapse: collapse; margin-top: 4px; page-break-inside:avoid; }
  th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid ${LINE}; }
  thead th { background:${NAVY}; color:#fff; font-size: 10.5px; text-transform: uppercase; letter-spacing:.4px; font-weight:600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td { font-weight: 700; color:${NAVY}; border-top: 2px solid ${NAVY}; background:${BG}; }
  .pos { color:#1a7f37; } .neg { color:#b3261e; }
  .alertbox { background:#fff6e6; border:1px solid #f0d9a8; border-radius:6px; padding:10px 14px; margin-top:10px; }
  .alert-h { font-weight:700; color:#8a5a00; margin-bottom:4px; }
  .alertbox ul { margin:4px 0 0 18px; padding:0; }
  .okbox { background:#eef8f0; border:1px solid #cfe9d5; color:#1a7f37; border-radius:6px; padding:10px 14px; margin-top:10px; font-weight:600; }
  .notebox { background:#f2f4f7; border:1px solid ${LINE}; color:${MUT}; border-radius:6px; padding:10px 14px; margin-top:10px; }
  .sub { color:${MUT}; font-size: 12px; margin-top: 2px; }
  .flow { display:flex; gap:6px; align-items:center; margin-top:8px; flex-wrap:wrap; }
  .flow .step { background:${BG}; border:1px solid ${LINE}; border-radius:6px; padding:8px 12px; text-align:center; min-width:110px; }
  .flow .step .l { font-size:10px; color:${MUT}; text-transform:uppercase; } .flow .step .v { font-weight:700; color:${NAVY}; font-size:13px; }
  .flow .op { font-size:16px; color:${GOLD}; font-weight:800; }
  .foot { margin-top: 22px; border-top:1px solid ${LINE}; padding-top:8px; color:${MUT}; font-size: 10px; }
  .foot b { color:${INK}; }`;

function headHtml(titulo, cond, sub) {
  return `<div class="head">
    <div class="brand">GRUPO <small>NCS</small></div>
    <div class="doc-t"><div class="t1">${esc(titulo)}</div><div class="t2">${esc(cond)} &middot; ${esc(sub)}</div></div>
  </div>`;
}

export function renderHTMLPeriodo(m, textoExec) {
  const res = m.resultado, P = m.temOrcamento, cond = m.condominio || {};
  const rescolor = res.tipo === 'superavit' ? '#1a7f37' : '#b3261e';
  const supdef = res.tipo === 'superavit' ? 'Superávit' : 'Déficit';

  const grafMensal = svgReceitaDespesaMensal(m.porMes);
  const grafPrev = P ? svgPrevistoRealizado(m.orcamentoDespesas) : '';

  const linhasMes = m.porMes.map(x => `<tr>
      <td>${esc((x.mesNome || '').charAt(0).toUpperCase() + (x.mesNome || '').slice(1))}</td>
      <td class="num">${brl(x.receitas)}</td>
      <td class="num">${brl(x.despesas)}</td>
      <td class="num ${x.resultado >= 0 ? 'pos' : 'neg'}">${brl(x.resultado)}</td>
    </tr>`).join('');

  const linhasDesp = m.orcamentoDespesas.map(c => {
    const alerta = c.desvioPct != null && c.desvioPct >= 5 && c.desvio > 0;
    const cor = c.desvioPct == null ? MUT : (c.desvioPct > 0 ? '#b3261e' : '#1a7f37');
    return `<tr${alerta ? ` style="background:#fff6e6"` : ''}>
      <td>${esc(c.descricao)}</td><td class="num">${brl(c.realizado)}</td>
      ${P ? `<td class="num">${brl(c.previsto)}</td><td class="num" style="color:${cor}">${pct(c.desvioPct)}</td>` : ''}
    </tr>`;
  }).join('');

  const alertasBloco = !P
    ? `<div class="notebox">Comparação com a previsão orçamentária não disponível para este condomínio via API (ver rodapé). O relatório mostra os valores realizados no período.</div>`
    : (m.alertas.length ? `<div class="alertbox"><div class="alert-h">⚠️ Categorias acima do orçado no período</div>
        <ul>${m.alertas.map(a => `<li><b>${esc(a.categoria)}</b>: ${brl(a.realizado)} contra previsão de ${brl(a.previsto)} — <b style="color:#b3261e">${pct(a.excedentePct)}</b></li>`).join('')}</ul></div>`
      : `<div class="okbox">✓ Nenhuma categoria de despesa ultrapassou a previsão no período.</div>`);

  const inad = m.inadimplencia;

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${STYLE}</style></head><body style="--rescolor:${rescolor}">
  ${headHtml('Relatório de Prestação de Contas — Período', cond.nome || '', m.periodo.label)}

  <div class="cards">
    <div class="card"><div class="card-t">Receitas (${m.periodo.nMeses}m)</div><div class="card-v">${brl(m.receitas.total)}</div><div class="prev">média ${brl(m.receitas.media)}/mês</div></div>
    <div class="card"><div class="card-t">Despesas (${m.periodo.nMeses}m)</div><div class="card-v">${brl(m.despesas.total)}</div><div class="prev">média ${brl(m.despesas.media)}/mês</div></div>
    <div class="card res"><div class="card-t">${supdef} acumulado</div><div class="card-v">${brl(res.valor)}</div><div class="prev">${res.mesesPositivos}/${m.periodo.nMeses} meses positivos</div></div>
  </div>

  <h2>Resumo executivo do período</h2>
  <div class="execbox">${paras(textoExec.resumo)}</div>

  <h2>Evolução mês a mês</h2>
  <div class="chartbox">${grafMensal}</div>
  <table>
    <thead><tr><th>Mês</th><th class="num">Receitas</th><th class="num">Despesas</th><th class="num">Resultado</th></tr></thead>
    <tbody>${linhasMes}</tbody>
    <tfoot><tr><td>Total do período</td><td class="num">${brl(m.receitas.total)}</td><td class="num">${brl(m.despesas.total)}</td><td class="num ${res.valor >= 0 ? 'pos' : 'neg'}">${brl(res.valor)}</td></tr></tfoot>
  </table>

  <h2>${P ? 'Despesas acumuladas por categoria — realizado × previsto' : 'Despesas acumuladas por categoria'}</h2>
  ${grafPrev ? `<div class="chartbox">${grafPrev}</div>` : ''}
  <table>
    <thead><tr><th>Categoria</th><th class="num">Realizado</th>${P ? '<th class="num">Previsto</th><th class="num">Desvio</th>' : ''}</tr></thead>
    <tbody>${linhasDesp}</tbody>
    <tfoot><tr><td>Total de despesas</td><td class="num">${brl(m.despesas.total)}</td>${P ? `<td class="num">${brl(m.despesas.previsto)}</td><td class="num">${pct(m.despesas.previsto ? ((m.despesas.total - m.despesas.previsto) / m.despesas.previsto) * 100 : null)}</td>` : ''}</tr></tfoot>
  </table>
  ${alertasBloco}

  <h2>Receitas acumuladas por categoria</h2>
  <table>
    <thead><tr><th>Categoria</th><th class="num">Valor</th></tr></thead>
    <tbody>${m.receitas.categorias.map(c => `<tr><td>${esc(c.descricao)}</td><td class="num">${brl(c.valor)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td>Total de receitas</td><td class="num">${brl(m.receitas.total)}</td></tr></tfoot>
  </table>

  <h2>Movimentação de caixa (período)</h2>
  <div class="flow">
    <div class="step"><div class="l">Saldo inicial</div><div class="v">${brl(m.caixa.saldoInicial)}</div></div>
    <div class="op">+</div>
    <div class="step"><div class="l">Entradas</div><div class="v" style="color:#1a7f37">${brl(m.caixa.entradas)}</div></div>
    <div class="op">−</div>
    <div class="step"><div class="l">Saídas</div><div class="v" style="color:#b3261e">${brl(m.caixa.saidas)}</div></div>
    <div class="op">=</div>
    <div class="step" style="border-color:${GOLD}"><div class="l">Saldo final</div><div class="v">${brl(m.caixa.saldoFinal)}</div></div>
  </div>

  <h2>Inadimplência (posição atual)</h2>
  <div class="sub">${inad.qtd ? `<b>${inad.qtd}</b> unidade(s) com pendências, somando <b>${brl(inad.total)}</b> em valores originais.${inad.unidades.some(u => u.juridico) ? ' Parte já em cobrança jurídica.' : ''}` : 'Sem inadimplência registrada.'}</div>

  <div class="foot">
    Dados extraídos da plataforma <b>Superlógica</b> (balancete de cada mês, caixa e inadimplência) referentes a ${esc(m.periodo.label)}.
    A inadimplência reflete a posição atual (não o histórico do período). ${P ? '' : 'A previsão orçamentária deste condomínio ainda não é lida automaticamente via API. '}
    Documento de apoio à gestão — não substitui a prestação de contas oficial. Gerado por <b>Grupo NCS</b> · IA de gestão.
  </div>
</body></html>`;
}

/**
 * Análise e Recomendações — foca na leitura consultiva sobre os números do período.
 * textoExec (resumo dos números) + textoRecom (recomendação advisory).
 */
export function renderHTMLAnalise(m, textoRecom, textoExec) {
  const res = m.resultado, cond = m.condominio || {};
  const rescolor = res.tipo === 'superavit' ? '#1a7f37' : '#b3261e';
  const supdef = res.tipo === 'superavit' ? 'Superávit' : 'Déficit';
  const grafMensal = svgReceitaDespesaMensal(m.porMes);

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${STYLE}</style></head><body style="--rescolor:${rescolor}">
  ${headHtml('Análise e Recomendações', cond.nome || '', m.periodo.label)}

  <div class="cards">
    <div class="card"><div class="card-t">Receitas (${m.periodo.nMeses}m)</div><div class="card-v">${brl(m.receitas.total)}</div><div class="prev">média ${brl(m.receitas.media)}/mês</div></div>
    <div class="card"><div class="card-t">Despesas (${m.periodo.nMeses}m)</div><div class="card-v">${brl(m.despesas.total)}</div><div class="prev">média ${brl(m.despesas.media)}/mês</div></div>
    <div class="card res"><div class="card-t">${supdef} acumulado</div><div class="card-v">${brl(res.valor)}</div><div class="prev">${res.mesesPositivos}/${m.periodo.nMeses} meses positivos</div></div>
  </div>

  <h2>Recomendação</h2>
  <div class="recbox">${paras(textoRecom.resumo)}</div>

  <h2>Leitura dos números</h2>
  <div class="execbox">${paras(textoExec.resumo)}</div>

  <h2>Evolução do resultado</h2>
  <div class="chartbox">${grafMensal}</div>

  <h2>Onde o dinheiro foi (maiores despesas do período)</h2>
  <table>
    <thead><tr><th>Categoria</th><th class="num">Total no período</th><th class="num">% das despesas</th></tr></thead>
    <tbody>${m.despesas.categorias.slice(0, 8).map(c => `<tr><td>${esc(c.descricao)}</td><td class="num">${brl(c.valor)}</td><td class="num">${m.despesas.total ? ((c.valor / m.despesas.total) * 100).toFixed(1) + '%' : '—'}</td></tr>`).join('')}</tbody>
  </table>

  <div class="foot">
    Análise gerada automaticamente sobre os números reais da <b>Superlógica</b> (${esc(m.periodo.label)}).
    As recomendações são <b>sugestões de apoio à gestão</b>; a decisão final (reajuste, cortes, etc.) é do síndico e da assembleia.
    Gerado por <b>Grupo NCS</b> · IA de gestão.
  </div>
</body></html>`;
}
