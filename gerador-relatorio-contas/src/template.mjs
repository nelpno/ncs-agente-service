// Template HTML branded NCS (navy #1a3a5c / dourado #c9a227) do relatório de prestação de contas.
// Todos os números vêm do modelo agregado; o texto executivo é a única parte redigida por LLM.
const NAVY = '#1a3a5c', GOLD = '#c9a227', INK = '#243141', MUT = '#6b7684', LINE = '#e4e8ee', BG = '#f6f8fb';

const brl = v => v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = v => v == null ? '—' : (v >= 0 ? '+' : '') + Number(v).toFixed(1) + '%';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const paras = t => esc(t).split(/\n{1,}/).filter(Boolean).map(p => `<p>${p}</p>`).join('');

function linhaCat(c, comPrev) {
  const alerta = c.desvioPct != null && c.desvioPct >= 5 && c.desvio > 0;
  const cor = c.desvioPct == null ? MUT : (c.desvioPct > 0 ? '#b3261e' : '#1a7f37');
  return `<tr${alerta ? ` style="background:#fff6e6"` : ''}>
    <td>${esc(c.descricao)}</td>
    <td class="num">${brl(c.realizado ?? c.valor)}</td>
    ${comPrev ? `<td class="num">${brl(c.previsto)}</td><td class="num" style="color:${cor}">${pct(c.desvioPct)}</td>` : ''}
  </tr>`;
}

export function renderHTML(m, textoExec) {
  const res = m.resultado;
  const supdef = res.tipo === 'superavit' ? 'Superávit' : 'Déficit';
  const supColor = res.tipo === 'superavit' ? '#1a7f37' : '#b3261e';
  const comp = m.comparativo;
  const cond = m.condominio || {};
  const P = m.temOrcamento; // só mostra previsão/desvio/alertas quando o orçamento é confiável p/ este condo

  const cardComparativo = comp ? `
    <div class="card">
      <div class="card-t">vs. mês anterior</div>
      <div class="mini">Receitas ${pct(comp.receitas.varPct)}</div>
      <div class="mini">Despesas ${pct(comp.despesas.varPct)}</div>
    </div>` : '';

  const alertasBloco = !P
    ? `<div class="notebox">Comparação com a previsão orçamentária não disponível para este condomínio via API (ver rodapé). O relatório mostra os valores realizados.</div>`
    : (m.alertas.length ? `
    <div class="alertbox">
      <div class="alert-h">⚠️ Categorias acima do orçado</div>
      <ul>${m.alertas.map(a => `<li><b>${esc(a.categoria)}</b>: gasto de ${brl(a.realizado)} contra previsão de ${brl(a.previsto)} — <b style="color:#b3261e">${pct(a.excedentePct)}</b></li>`).join('')}</ul>
    </div>` : `<div class="okbox">✓ Nenhuma categoria de despesa ultrapassou a previsão orçamentária no mês.</div>`);

  const receitaComPrev = m.receitas.categorias.some(c => false); // receita não traz previsto por categoria (só total)
  const inad = m.inadimplencia;

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<style>
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
  .sub { color:${MUT}; font-size: 12px; margin-top: 2px; }
  .cards { display:flex; gap: 10px; margin-top: 14px; }
  .card { flex:1; background:${BG}; border:1px solid ${LINE}; border-radius: 8px; padding: 12px 14px; }
  .card-t { font-size: 10.5px; text-transform:uppercase; letter-spacing:.5px; color:${MUT}; }
  .card-v { font-size: 19px; font-weight: 800; color:${NAVY}; margin-top: 4px; }
  .card .prev { font-size: 10.5px; color:${MUT}; margin-top:2px; }
  .card.res .card-v { color:${supColor}; }
  .mini { font-size: 12px; margin-top: 3px; }
  .execbox { background:#fbfcfe; border:1px solid ${LINE}; border-left:4px solid ${NAVY}; border-radius:6px; padding: 12px 16px; margin-top: 8px; }
  .execbox p { margin: 0 0 8px; } .execbox p:last-child { margin: 0; }
  table { width:100%; border-collapse: collapse; margin-top: 4px; }
  th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid ${LINE}; }
  thead th { background:${NAVY}; color:#fff; font-size: 10.5px; text-transform: uppercase; letter-spacing:.4px; font-weight:600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td { font-weight: 700; color:${NAVY}; border-top: 2px solid ${NAVY}; background:${BG}; }
  .alertbox { background:#fff6e6; border:1px solid #f0d9a8; border-radius:6px; padding:10px 14px; margin-top:10px; }
  .alert-h { font-weight:700; color:#8a5a00; margin-bottom:4px; }
  .alertbox ul, .execbox ul { margin:4px 0 0 18px; padding:0; }
  .okbox { background:#eef8f0; border:1px solid #cfe9d5; color:#1a7f37; border-radius:6px; padding:10px 14px; margin-top:10px; font-weight:600; }
  .notebox { background:#f2f4f7; border:1px solid ${LINE}; color:${MUT}; border-radius:6px; padding:10px 14px; margin-top:10px; }
  .flow { display:flex; gap:6px; align-items:center; margin-top:8px; flex-wrap:wrap; }
  .flow .step { background:${BG}; border:1px solid ${LINE}; border-radius:6px; padding:8px 12px; text-align:center; min-width:120px; }
  .flow .step .l { font-size:10px; color:${MUT}; text-transform:uppercase; } .flow .step .v { font-weight:700; color:${NAVY}; font-size:13px; }
  .flow .op { font-size:16px; color:${GOLD}; font-weight:800; }
  .foot { margin-top: 22px; border-top:1px solid ${LINE}; padding-top:8px; color:${MUT}; font-size: 10px; }
  .foot b { color:${INK}; }
</style></head><body>

  <div class="head">
    <div class="brand">GRUPO <small>NCS</small></div>
    <div class="doc-t">
      <div class="t1">Relatório de Prestação de Contas</div>
      <div class="t2">${esc(cond.nome || '')} &middot; ${esc(m.periodo.label)}</div>
    </div>
  </div>

  <div class="cards">
    <div class="card"><div class="card-t">Receitas</div><div class="card-v">${brl(m.receitas.total)}</div>${P ? `<div class="prev">previsto ${brl(m.receitas.previsto)}</div>` : ''}</div>
    <div class="card"><div class="card-t">Despesas</div><div class="card-v">${brl(m.despesas.total)}</div>${P ? `<div class="prev">previsto ${brl(m.despesas.previsto)}</div>` : ''}</div>
    <div class="card res"><div class="card-t">${supdef} do mês</div><div class="card-v">${brl(res.valor)}</div>${P ? `<div class="prev">previsto ${brl(res.previsto)}</div>` : ''}</div>
    ${cardComparativo}
  </div>

  <h2>Resumo executivo</h2>
  <div class="execbox">${paras(textoExec.resumo)}</div>

  <h2>${P ? 'Despesas por categoria — realizado × previsto' : 'Despesas por categoria'}</h2>
  <table>
    <thead><tr><th>Categoria</th><th class="num">Realizado</th>${P ? '<th class="num">Previsto</th><th class="num">Desvio</th>' : ''}</tr></thead>
    <tbody>${m.orcamentoDespesas.map(c => linhaCat(c, P)).join('')}</tbody>
    <tfoot><tr><td>Total de despesas</td><td class="num">${brl(m.despesas.total)}</td>${P ? `<td class="num">${brl(m.despesas.previsto)}</td><td class="num">${pct(m.despesas.previsto ? ((m.despesas.total - m.despesas.previsto) / m.despesas.previsto) * 100 : null)}</td>` : ''}</tr></tfoot>
  </table>
  ${alertasBloco}

  <h2>Receitas por categoria</h2>
  <table>
    <thead><tr><th>Categoria</th><th class="num">Valor</th></tr></thead>
    <tbody>${m.receitas.categorias.map(c => `<tr><td>${esc(c.descricao)}</td><td class="num">${brl(c.valor)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td>Total de receitas</td><td class="num">${brl(m.receitas.total)}</td></tr></tfoot>
  </table>

  <h2>Movimentação de caixa</h2>
  <div class="flow">
    <div class="step"><div class="l">Saldo inicial</div><div class="v">${brl(m.caixa.saldoInicial)}</div></div>
    <div class="op">+</div>
    <div class="step"><div class="l">Entradas</div><div class="v" style="color:#1a7f37">${brl(m.caixa.entradas)}</div></div>
    <div class="op">−</div>
    <div class="step"><div class="l">Saídas</div><div class="v" style="color:#b3261e">${brl(m.caixa.saidas)}</div></div>
    <div class="op">=</div>
    <div class="step" style="border-color:${GOLD}"><div class="l">Saldo final</div><div class="v">${brl(m.caixa.saldoFinal)}</div></div>
  </div>

  <h2>Inadimplência</h2>
  <div class="sub">${inad.qtd ? `<b>${inad.qtd}</b> unidade(s) com pendências, somando <b>${brl(inad.total)}</b> em valores originais.${inad.unidades.some(u => u.juridico) ? ' Parte já em cobrança jurídica.' : ''}` : 'Sem inadimplência registrada no período.'}</div>

  <div class="foot">
    Dados extraídos da plataforma <b>Superlógica</b> (balancete${P ? ', orçamento' : ''}, caixa e inadimplência) referentes a ${esc(m.periodo.label)}.
    Os valores são apurados diretamente do sistema; o texto executivo é gerado automaticamente sobre esses números.
    ${P ? '' : 'A previsão orçamentária deste condomínio ainda não é lida automaticamente via API (disponível apenas no relatório interno da Superlógica); a comparação previsto × realizado será incluída quando essa fonte for habilitada. '}
    Documento de apoio à gestão — não substitui a prestação de contas oficial. Gerado por <b>Grupo NCS</b> · IA de gestão.
  </div>

</body></html>`;
}
