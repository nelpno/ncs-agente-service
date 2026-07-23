// Resumo Financeiro mensal (metodologia do Fernando, validada ao vivo no Attuale jun/2026):
//   RECEITA ajustada = Total de Receitas − Fundo de Reserva − Rendimentos − Taxa Extra
//   DESPESA ajustada = Total de Despesas − Despesas com Investimento
//   SALDO total      = "Saldo anterior" (caixa) + soma dos movimentos do período (vl_valor_mov já sinalizado)
//   SITUAÇÃO         = Positiva se (receita − despesa) >= 0, senão Negativa
// As exclusões são por NOME de categoria (nível 2 do plano de contas), pois variam de mês a mês
// (ex.: "Despesas com Investimento" só existe quando houve investimento). Cálculo é DETERMINÍSTICO.
import { balancete, caixa, periodoMes } from './superlogica-financeiro.mjs';

const nivel = (conta) => String(conta).split('.').filter(Boolean).length;
const RE_EXCLUI_RECEITA = /fundo de reserva|rendiment|taxa extra/i;
const RE_EXCLUI_DESPESA = /investiment/i;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export const num = (v) => {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/\s/g, '');
  if (s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
  return parseFloat(s) || 0;
};
export const fmtBRL = (n) => (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MESES = ['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const nomeMes = (m) => MESES[Number(m)] || '';

// ---- núcleo PURO (recebe os dados já buscados; sem API) ----
export function calcularReceita(itens) {
  const rec = itens.filter((x) => String(x.conta).startsWith('1'));
  const total = rec.filter((x) => nivel(x.conta) === 1).reduce((s, x) => s + num(x.valor), 0);
  const exclusoes = rec.filter((x) => nivel(x.conta) === 2 && RE_EXCLUI_RECEITA.test(x.descricao))
    .map((x) => ({ descricao: x.descricao, valor: num(x.valor) }));
  const somaExcl = exclusoes.reduce((s, e) => s + e.valor, 0);
  return { total: round2(total), exclusoes, ajustada: round2(total - somaExcl) };
}

export function calcularDespesa(itens) {
  const desp = itens.filter((x) => String(x.conta).startsWith('2'));
  const total = desp.filter((x) => nivel(x.conta) === 1).reduce((s, x) => s + num(x.valor), 0);
  const exclusoes = desp.filter((x) => nivel(x.conta) === 2 && RE_EXCLUI_DESPESA.test(x.descricao))
    .map((x) => ({ descricao: x.descricao, valor: num(x.valor) }));
  const somaExcl = exclusoes.reduce((s, e) => s + e.valor, 0);
  return { total: round2(total), exclusoes, ajustada: round2(total - somaExcl) };
}

export function calcularSaldo(caixaItens) {
  let saldoAnterior = 0, movimentos = 0;
  for (const it of caixaItens || []) {
    if (/saldo anterior/i.test(it.st_descricao_mov || '')) saldoAnterior += num(it.saldoinicialconta);
    else if (it.vl_valor_mov !== undefined && it.vl_valor_mov !== '') movimentos += num(it.vl_valor_mov);
  }
  return { saldoAnterior: round2(saldoAnterior), movimentos: round2(movimentos), total: round2(saldoAnterior + movimentos) };
}

// Nome limpo da categoria (remove o prefixo numérico do plano de contas: "1.1 Taxa Condomínio" -> "Taxa Condomínio")
const limpaCat = (d) => String(d).replace(/^\d[\d.]*\s*/, '').trim();

// DESTAQUES: categorias (nível 2) que mais pesaram — pedido do Fernando (23/07): "incluir o motivo que deu positivo".
// Determinístico (zero alucinação): ordena por valor absoluto. Exclui as não-ordinárias que já saem do cálculo
// (Fundo de Reserva/Rendimentos/Taxa Extra na receita; Investimento na despesa) para não confundir o motivo.
export function destaques(balanceteItens, max = 3) {
  // soPositivos: nas receitas ignora deduções (ex.: Taxa Cobrança negativa), que confundem como "maior receita".
  const cats = (pref, reExcluir, soPositivos) => balanceteItens
    .filter((x) => String(x.conta).startsWith(pref) && nivel(x.conta) === 2 && num(x.valor) !== 0
      && !reExcluir.test(limpaCat(x.descricao)) && (!soPositivos || num(x.valor) > 0))
    .map((x) => ({ descricao: limpaCat(x.descricao), valor: num(x.valor) }))
    .sort((a, b) => b.valor - a.valor);
  return { receitas: cats('1', RE_EXCLUI_RECEITA, true).slice(0, max), despesas: cats('2', RE_EXCLUI_DESPESA, false).slice(0, max) };
}

// MOTIVO do resultado, em 1 frase, citando as categorias reais que mais pesaram (nunca inventa).
export function motivoResultado(resumo, dest) {
  const pos = resumo.resultado >= 0;
  const lista = (arr) => arr.map((x) => x.descricao).filter(Boolean).join(', ');
  const rec = lista(dest.receitas);
  const desp = lista(dest.despesas);
  const conj = pos ? 'a arrecadação do período cobriu as despesas' : 'as despesas do período superaram a arrecadação';
  const parteRec = rec ? ` As receitas vieram principalmente de ${rec}.` : '';
  const parteDesp = desp ? ` As despesas concentraram-se em ${desp}.` : '';
  return `O resultado ${pos ? 'positivo' : 'negativo'} reflete que ${conj}.${parteRec}${parteDesp}`;
}

// COMPARAÇÃO com o mês anterior (pedido do Fernando: "faz a comparação com o mês anterior pra ver o que impactou").
// Determinístico: variação por categoria (nível 2). Exclui as não-ordinárias do cálculo. Ordena por |variação|.
export function compararMeses(atualItens, anteriorItens) {
  const idx = (arr, pref, reExcluir) => {
    const m = {};
    for (const x of arr || []) {
      if (!String(x.conta).startsWith(pref) || nivel(x.conta) !== 2) continue;
      const nome = limpaCat(x.descricao);
      if (reExcluir.test(nome)) continue;
      m[nome] = round2((m[nome] || 0) + num(x.valor));
    }
    return m;
  };
  const variacoes = (pref, reExcluir) => {
    const a = idx(anteriorItens, pref, reExcluir), b = idx(atualItens, pref, reExcluir);
    return [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .map((k) => ({ descricao: k, anterior: round2(a[k] || 0), atual: round2(b[k] || 0), dif: round2((b[k] || 0) - (a[k] || 0)) }))
      .filter((x) => x.dif !== 0)
      .sort((x, y) => Math.abs(y.dif) - Math.abs(x.dif));
  };
  return { receitas: variacoes('1', RE_EXCLUI_RECEITA), despesas: variacoes('2', RE_EXCLUI_DESPESA) };
}

// Regra do Fernando: NÃO apontar terceirização/pessoal como CAUSA do resultado (senão o síndico corta a terceirização,
// que é o serviço da NCS). Reenquadramento (recomendação Fable): a categoria SEGUE nos totais e nos quadros de variação;
// a regra atua SÓ no texto do "motivo" — e nunca promove uma categoria menor a "causa" quando pessoal/terceirização domina
// (isso seria falso por omissão). Quando ela domina e não há outra causa material, usa formulação AGREGADA.
const EXCLUI_CAUSA = /terceir|prestad|pessoal|funcion|encargo/i;
const MAT_RS = 500;       // piso de materialidade (reais)
const MAT_PCT = 0.08;     // e 8% sobre a base — evita citar variação irrisória de categoria pequena
const MAT_RS_ALTO = 2000; // variação grande em R$ é sempre relevante, mesmo com % baixo (ex.: Taxa Condomínio numa base alta)
export function materialVar(x) {
  const base = Math.max(Math.abs(x.anterior || 0), Math.abs(x.atual || 0), 1);
  const abs = Math.abs(x.dif);
  return abs >= MAT_RS_ALTO || (abs >= MAT_RS && abs >= MAT_PCT * base);
}

// MOTIVO com base na comparação (materialidade + reenquadramento + lado da receita). A RAZÃO editorial
// ("por que subiu") é da equipe — o documento sai em Word editável para completar.
export function motivoComparativo(resumo, comp, rotuloAtual, rotuloAnterior) {
  if (!comp || (!comp.receitas.length && !comp.despesas.length)) return motivoResultado(resumo, resumo.destaques);
  const neg = resumo.resultado < 0;
  const dstr = (x) => `${x.descricao} (${x.dif >= 0 ? 'alta de' : 'queda de'} R$ ${fmtBRL(Math.abs(x.dif))})`;
  const despSubMat = comp.despesas.filter((x) => x.dif > 0 && materialVar(x));
  const despCausa = despSubMat.filter((x) => !EXCLUI_CAUSA.test(x.descricao)).slice(0, 2);
  const pessoalDomina = despSubMat.length > 0 && EXCLUI_CAUSA.test(despSubMat[0].descricao);
  const recCaiu = comp.receitas.filter((x) => x.dif < 0 && materialVar(x)).slice(0, 2);
  const recMov = comp.receitas.filter((x) => materialVar(x)).slice(0, 2);

  const partes = [];
  if (despCausa.length) {
    partes.push(`Em relação a ${rotuloAnterior}, as despesas que mais variaram foram ${despCausa.map(dstr).join(' e ')}.`);
  } else if (pessoalDomina || despSubMat.length) {
    // pessoal/terceirização domina e não há outra causa material → agregado (não culpa a terceirização nem promove menores)
    partes.push(`Em relação a ${rotuloAnterior}, o resultado reflete o conjunto das despesas ordinárias do período, detalhadas no quadro acima.`);
  }
  if (neg && recCaiu.length) {
    partes.push(`Também pesou a redução de receitas em ${recCaiu.map(dstr).join(' e ')}.`);
  } else if (recMov.length) {
    partes.push(`Nas receitas, os maiores movimentos foram ${recMov.map(dstr).join(' e ')}.`);
  }
  if (!partes.length) partes.push(`O resultado reflete o conjunto das receitas e despesas do período, detalhadas nos quadros acima.`);
  return partes.join(' ');
}

export function calcularResumo(balanceteItens, caixaItens) {
  const receita = calcularReceita(balanceteItens);
  const despesa = calcularDespesa(balanceteItens);
  const resultado = round2(receita.ajustada - despesa.ajustada);
  const saldo = calcularSaldo(caixaItens);
  const dest = destaques(balanceteItens);
  return {
    receitaAjustada: receita.ajustada,
    despesaAjustada: despesa.ajustada,
    resultado,
    situacao: resultado >= 0 ? 'Positiva' : 'Negativa',
    saldoTotal: saldo.total,
    destaques: dest,
    detalhe: { receita, despesa, saldo },
  };
}

export function textoInformativo(resumo, mes) {
  const positivo = resumo.resultado >= 0;
  const palavra = positivo ? 'superávit' : 'déficit';
  const valor = fmtBRL(Math.abs(resumo.resultado));
  // Abertura (o motivo/comparação emenda em seguida, no mesmo parágrafo — modelo do Fernando).
  return `Informamos que o condomínio encerrou o mês de ${nomeMes(mes)} com ${palavra} no valor de R$ ${valor}.`;
}

export const RODAPE_LGPD = 'As informações deste informativo são sensíveis e destinadas exclusivamente aos gestores eleitos em assembleia ordinária, conforme a Lei Geral de Proteção de Dados (LGPD). A divulgação a terceiros é expressamente proibida.';
// Nota metodológica (recomendação Fable): inocula contra o mal-entendido de competência/caixa (ex.: 2 vencimentos no mesmo mês).
export const NOTA_METODOLOGICA = 'Valores apurados em regime de caixa (data de pagamento); variações mensais podem refletir a concentração de vencimentos no período. Dados extraídos do sistema na data de emissão; o balancete oficial prevalece.';

// ---- render 1 página (HTML self-contained; vira PDF/Word pelo mesmo motor do relatório) ----
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function renderHTMLResumo(r) {
  const pos = r.situacao === 'Positiva';
  const cor = pos ? '#1b7a3d' : '#b3261e';
  const excl = (arr) => (arr.length ? arr.map((e) => `${esc(String(e.descricao).replace(/^\d[\d.]*\s*/, ''))} (R$ ${fmtBRL(e.valor)})`).join(' · ') : 'nenhuma');
  const linha = (lbl, val, obs) => `<tr><td class="lbl">${lbl}</td><td class="val">R$ ${fmtBRL(val)}</td><td class="obs">${obs || ''}</td></tr>`;
  // valor do MÊS (não a variação): receita positiva em verde, despesa (custo) em vermelho — leitura intuitiva (feedback Fernando 23/07).
  const dlist = (arr, ehReceita) => `<ul>${(arr || []).map((x) => `<li><span>${esc(x.descricao)}</span><span class="dv ${ehReceita ? 'pos' : 'neg'}">R$ ${fmtBRL(x.valor)}</span></li>`).join('') || '<li>—</li>'}</ul>`;
  // cor por TIPO (pedido do Fernando 23/07): receita sempre verde, despesa sempre vermelha; o +/- indica a direção.
  const vlist = (arr, ehReceita) => `<ul>${(arr || []).slice(0, 4).map((x) => `<li><span>${esc(x.descricao)}</span><span class="dv ${ehReceita ? 'pos' : 'neg'}">${x.dif >= 0 ? '+' : '-'}R$ ${fmtBRL(Math.abs(x.dif))}</span></li>`).join('') || '<li>—</li>'}</ul>`;
  const rotAnt = r.periodo?.mesAnterior?.rotulo || 'mês anterior';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<style>
@page{size:A4;margin:14mm}
*{box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}
body{margin:0;color:#222}
.hdr{background:#1b7a3d;color:#fff;padding:16px 20px;border-radius:8px;text-align:center}
.hdr h1{margin:0;font-size:20px;letter-spacing:.5px}
.hdr .sub{margin-top:4px;font-size:13px;opacity:.92}
.saldo{margin:16px 0;padding:14px 18px;border:2px solid #1b7a3d;border-radius:8px;display:flex;justify-content:space-between;align-items:center}
.saldo .k{font-size:13px;color:#555;text-transform:uppercase;letter-spacing:.5px}
.saldo .v{font-size:26px;font-weight:bold;color:#1b7a3d}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0}
.card{border-radius:8px;padding:14px 16px;color:#fff}
.card .k{font-size:12px;text-transform:uppercase;letter-spacing:.5px;opacity:.9}
.card .v{font-size:22px;font-weight:bold;margin-top:4px}
.c-rec{background:#1b7a3d}.c-desp{background:#3a3f45}.c-res{background:${cor}}.c-sit{background:${cor};display:flex;flex-direction:column;justify-content:center}
table.det{width:100%;border-collapse:collapse;margin:8px 0;font-size:12px}
table.det td{padding:5px 8px;border-bottom:1px solid #eee}
.det .lbl{color:#444}.det .val{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.det .obs{color:#888;font-size:11px}
.destaques{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0}
.dcol{border:1px solid #e3e8e4;border-radius:6px;padding:10px 12px}
.dcol .dh{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#1b7a3d;font-weight:bold;margin-bottom:6px}
.dcol ul{margin:0;padding:0;list-style:none}
.dcol li{display:flex;justify-content:space-between;gap:10px;font-size:12px;padding:3px 0;border-bottom:1px solid #f0f0f0}
.dcol li:last-child{border-bottom:none}
.dcol li .dv{font-variant-numeric:tabular-nums;white-space:nowrap;color:#333;font-weight:bold}
.dcol li .dv.pos{color:#1b7a3d}.dcol li .dv.neg{color:#b3261e}
.info{margin:16px 0;padding:12px 16px;background:#f2f8f4;border-left:4px solid #1b7a3d;border-radius:4px;font-size:13px;line-height:1.5}
.info p{margin:0 0 8px}.info p:last-child{margin:0}
.lgpd{margin-top:20px;font-size:10px;color:#888;line-height:1.4;border-top:1px solid #ddd;padding-top:8px}
</style></head><body>
<div class="hdr"><h1>RESUMO FINANCEIRO — ${esc(r.periodo.rotulo.toUpperCase())}</h1><div class="sub">${esc(r.condominio)}</div></div>
<div class="saldo"><div class="k">Saldo total em conta</div><div class="v">R$ ${fmtBRL(r.saldoTotal)}</div></div>
<div class="grid">
  <div class="card c-rec"><div class="k">Receita (ordinária)</div><div class="v">R$ ${fmtBRL(r.receitaAjustada)}</div></div>
  <div class="card c-desp"><div class="k">Despesa (ordinária)</div><div class="v">R$ ${fmtBRL(r.despesaAjustada)}</div></div>
  <div class="card c-res"><div class="k">Receita − Despesa</div><div class="v">R$ ${fmtBRL(r.resultado)}</div></div>
  <div class="card c-sit"><div class="k">Situação</div><div class="v">${esc(r.situacao.toUpperCase())}</div></div>
</div>
<table class="det">
  ${linha('Total de receitas', r.detalhe.receita.total, 'exclui: ' + excl(r.detalhe.receita.exclusoes))}
  ${linha('Receita ordinária considerada', r.receitaAjustada, '')}
  ${linha('Total de despesas', r.detalhe.despesa.total, r.detalhe.despesa.exclusoes.length ? 'exclui: ' + excl(r.detalhe.despesa.exclusoes) : 'sem investimento no período')}
  ${linha('Despesa ordinária considerada', r.despesaAjustada, '')}
</table>
<div class="destaques">
  <div class="dcol"><div class="dh">Maiores receitas do mês</div>${dlist(r.destaques?.receitas, true)}</div>
  <div class="dcol"><div class="dh">Maiores despesas do mês</div>${dlist(r.destaques?.despesas, false)}</div>
</div>
<div class="info"><p>${esc(r.texto)}${r.motivo ? ' ' + esc(r.motivo) : ''}</p></div>
<div class="lgpd">${r.nota ? esc(r.nota) + '<br><br>' : ''}${esc(r.lgpd)}</div>
</body></html>`;
}

// ---- orquestração (busca da API + calcula) ----
// deps injetável ({ balancete, caixa }) para teste sem rede.
export async function montarResumoFinanceiro({ idCondominio, ano, mes, nomeCondominio }, deps = {}) {
  const _balancete = deps.balancete || balancete;
  const _caixa = deps.caixa || caixa;
  const { dtInicio, dtFim } = periodoMes(ano, mes);
  // mês anterior (para a comparação pedida pelo Fernando)
  let mesAnt = Number(mes) - 1, anoAnt = Number(ano);
  if (mesAnt < 1) { mesAnt = 12; anoAnt -= 1; }
  const pa = periodoMes(anoAnt, mesAnt);
  const [bal, cx, balAnt] = await Promise.all([
    _balancete(idCondominio, dtInicio, dtFim),
    _caixa(idCondominio, dtInicio, dtFim),
    Promise.resolve(_balancete(idCondominio, pa.dtInicio, pa.dtFim)).catch(() => null),
  ]);
  const itens = bal.itens || bal; // balancete() devolve {nomeplanocontas, itens}
  const itensAnt = balAnt ? (balAnt.itens || balAnt) : null;
  const resumo = calcularResumo(itens, cx);
  const comparacao = (itensAnt && itensAnt.length) ? compararMeses(itens, itensAnt) : null;
  return {
    condominio: nomeCondominio || bal.nomeplanocontas || '',
    periodo: { mes: Number(mes), ano: Number(ano), rotulo: `${nomeMes(mes)}/${ano}`, mesAnterior: { mes: mesAnt, ano: anoAnt, rotulo: `${nomeMes(mesAnt)}/${anoAnt}` } },
    ...resumo,
    comparacao,
    texto: textoInformativo(resumo, mes),
    motivo: comparacao ? motivoComparativo(resumo, comparacao, nomeMes(mes), nomeMes(mesAnt)) : motivoResultado(resumo, resumo.destaques),
    nota: NOTA_METODOLOGICA,
    lgpd: RODAPE_LGPD,
  };
}
