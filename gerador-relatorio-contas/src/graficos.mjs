// Gráficos em SVG DETERMINÍSTICO (sem lib, sem CDN, sem <img>) para embutir INLINE no HTML do relatório.
// Por que SVG server-side e não Chart.js: o container renderiza o PDF em Chromium headless SEM internet
// (CSP/offline) e sem depender de timing de JS — markup estático sempre desenha igual.
const NAVY = '#1a3a5c', GOLD = '#c9a227', GREEN = '#1a7f37', RED = '#b3261e', MUT = '#6b7684', LINE = '#e4e8ee';

const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
// rótulo curto de valor no eixo (R$ 12.500 -> "12,5k")
function kLabel(v) {
  const n = Number(v) || 0, a = Math.abs(n), sig = n < 0 ? '-' : '';
  if (a >= 1000) { const k = a / 1000; return sig + (k >= 10 ? Math.round(k) : k.toFixed(1).replace('.', ',')) + 'k'; }
  return sig + Math.round(a);
}
// "nice" máximo do eixo (arredonda p/ cima em 1/2/5 × 10^n) para gridlines redondas
function niceMax(v) {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v)), base = v / Math.pow(10, exp);
  const nice = base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10;
  return nice * Math.pow(10, exp);
}

/**
 * Barras agrupadas Receita × Despesa por mês + linha do Resultado.
 * porMes: [{ mesNome, receitas, despesas, resultado }]
 */
export function svgReceitaDespesaMensal(porMes, { w = 760, h = 260 } = {}) {
  if (!porMes || porMes.length === 0) return '';
  const padL = 46, padR = 14, padT = 14, padB = 40;
  const iw = w - padL - padR, ih = h - padT - padB;
  const max = niceMax(Math.max(1, ...porMes.flatMap(m => [m.receitas, m.despesas])));
  const n = porMes.length;
  const gW = iw / n, barW = Math.min(26, gW * 0.30), gap = 4;
  const y = v => padT + ih - (Math.max(0, v) / max) * ih;
  const cx = i => padL + gW * i + gW / 2;

  // gridlines + labels do eixo Y (4 faixas)
  let grid = '';
  for (let g = 0; g <= 4; g++) {
    const val = max * g / 4, yy = padT + ih - (g / 4) * ih;
    grid += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${w - padR}" y2="${yy.toFixed(1)}" stroke="${LINE}" stroke-width="1"/>`;
    grid += `<text x="${padL - 6}" y="${(yy + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="${MUT}">${kLabel(val)}</text>`;
  }

  let bars = '', labels = '', linePts = [];
  porMes.forEach((m, i) => {
    const c = cx(i);
    const xr = c - barW - gap / 2, xd = c + gap / 2;
    bars += `<rect x="${xr.toFixed(1)}" y="${y(m.receitas).toFixed(1)}" width="${barW}" height="${(padT + ih - y(m.receitas)).toFixed(1)}" fill="${NAVY}" rx="2"/>`;
    bars += `<rect x="${xd.toFixed(1)}" y="${y(m.despesas).toFixed(1)}" width="${barW}" height="${(padT + ih - y(m.despesas)).toFixed(1)}" fill="${GOLD}" rx="2"/>`;
    labels += `<text x="${c.toFixed(1)}" y="${h - padB + 15}" text-anchor="middle" font-size="10" fill="${MUT}">${esc((m.mesNome || '').slice(0, 3))}</text>`;
    linePts.push([c, y(m.resultado)]);
  });

  // linha do resultado (pode ser negativo — clampa ao piso do gráfico)
  const yBase = padT + ih;
  const clamp = yy => Math.max(padT, Math.min(yBase, yy));
  const poly = linePts.map(([x, yy]) => `${x.toFixed(1)},${clamp(yy).toFixed(1)}`).join(' ');
  const dots = linePts.map(([x, yy]) => `<circle cx="${x.toFixed(1)}" cy="${clamp(yy).toFixed(1)}" r="3" fill="${GREEN}"/>`).join('');
  const lineEl = linePts.length > 1 ? `<polyline points="${poly}" fill="none" stroke="${GREEN}" stroke-width="2"/>${dots}` : dots;

  const legend = `
    <g font-size="10" fill="${MUT}">
      <rect x="${padL}" y="${h - 12}" width="10" height="10" fill="${NAVY}" rx="2"/><text x="${padL + 14}" y="${h - 3}">Receitas</text>
      <rect x="${padL + 74}" y="${h - 12}" width="10" height="10" fill="${GOLD}" rx="2"/><text x="${padL + 88}" y="${h - 3}">Despesas</text>
      <line x1="${padL + 160}" y1="${h - 7}" x2="${padL + 178}" y2="${h - 7}" stroke="${GREEN}" stroke-width="2"/><circle cx="${padL + 169}" cy="${h - 7}" r="3" fill="${GREEN}"/><text x="${padL + 182}" y="${h - 3}">Resultado</text>
    </g>`;

  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" xmlns="http://www.w3.org/2000/svg" role="img" font-family="'Segoe UI',Arial,sans-serif">
    ${grid}${bars}${lineEl}${labels}${legend}
  </svg>`;
}

/**
 * Barras horizontais Previsto × Realizado das maiores categorias de despesa.
 * cats: [{ descricao, previsto, realizado }]  (usa só as que têm previsto != null)
 */
export function svgPrevistoRealizado(cats, { w = 760, topN = 6 } = {}) {
  const rows = (cats || []).filter(c => c.previsto != null && (c.previsto > 0 || c.realizado > 0)).slice(0, topN);
  if (!rows.length) return '';
  const padL = 150, padR = 60, padT = 10, padB = 24;
  const rowH = 30, ih = rows.length * rowH, h = padT + ih + padB;
  const iw = w - padL - padR;
  const max = niceMax(Math.max(1, ...rows.flatMap(c => [c.previsto, c.realizado])));
  const bw = v => (Math.max(0, v) / max) * iw;

  let grid = '';
  for (let g = 0; g <= 4; g++) {
    const xx = padL + (g / 4) * iw, val = max * g / 4;
    grid += `<line x1="${xx.toFixed(1)}" y1="${padT}" x2="${xx.toFixed(1)}" y2="${padT + ih}" stroke="${LINE}" stroke-width="1"/>`;
    grid += `<text x="${xx.toFixed(1)}" y="${padT + ih + 15}" text-anchor="middle" font-size="9" fill="${MUT}">${kLabel(val)}</text>`;
  }

  let bars = '';
  rows.forEach((c, i) => {
    const yTop = padT + i * rowH, bh = 9;
    const estouro = c.realizado > c.previsto * 1.05;
    const nome = (c.descricao || '').length > 22 ? (c.descricao || '').slice(0, 21) + '…' : (c.descricao || '');
    bars += `<text x="${padL - 8}" y="${(yTop + rowH / 2 + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="${NAVY}">${esc(nome)}</text>`;
    bars += `<rect x="${padL}" y="${yTop + 4}" width="${bw(c.previsto).toFixed(1)}" height="${bh}" fill="${GOLD}" opacity="0.55" rx="2"/>`;
    bars += `<rect x="${padL}" y="${yTop + 4 + bh + 1}" width="${bw(c.realizado).toFixed(1)}" height="${bh}" fill="${estouro ? RED : NAVY}" rx="2"/>`;
  });

  const legend = `<g font-size="10" fill="${MUT}">
      <rect x="${padL}" y="${h - 11}" width="10" height="9" fill="${GOLD}" opacity="0.55" rx="2"/><text x="${padL + 14}" y="${h - 3}">Previsto</text>
      <rect x="${padL + 74}" y="${h - 11}" width="10" height="9" fill="${NAVY}" rx="2"/><text x="${padL + 88}" y="${h - 3}">Realizado</text>
      <rect x="${padL + 160}" y="${h - 11}" width="10" height="9" fill="${RED}" rx="2"/><text x="${padL + 174}" y="${h - 3}">Acima do previsto</text>
    </g>`;

  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" xmlns="http://www.w3.org/2000/svg" role="img" font-family="'Segoe UI',Arial,sans-serif">
    ${grid}${bars}${legend}
  </svg>`;
}

export { kLabel, niceMax };
