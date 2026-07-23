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

export function calcularResumo(balanceteItens, caixaItens) {
  const receita = calcularReceita(balanceteItens);
  const despesa = calcularDespesa(balanceteItens);
  const resultado = round2(receita.ajustada - despesa.ajustada);
  const saldo = calcularSaldo(caixaItens);
  return {
    receitaAjustada: receita.ajustada,
    despesaAjustada: despesa.ajustada,
    resultado,
    situacao: resultado >= 0 ? 'Positiva' : 'Negativa',
    saldoTotal: saldo.total,
    detalhe: { receita, despesa, saldo },
  };
}

export function textoInformativo(resumo, mes) {
  const positivo = resumo.resultado >= 0;
  const palavra = positivo ? 'superávit' : 'déficit';
  const valor = fmtBRL(Math.abs(resumo.resultado));
  const frase2 = positivo
    ? 'Esse resultado positivo reflete o equilíbrio entre as receitas ordinárias arrecadadas e as despesas realizadas no período.'
    : 'Esse resultado indica que as despesas do período superaram as receitas ordinárias arrecadadas; recomenda-se atenção dos gestores à saúde financeira.';
  return `Informamos que o condomínio encerrou o mês de ${nomeMes(mes)} com ${palavra} no valor de R$ ${valor}. ${frase2}`;
}

export const RODAPE_LGPD = 'As informações deste informativo são sensíveis e destinadas exclusivamente aos gestores eleitos em assembleia ordinária, conforme a Lei Geral de Proteção de Dados (LGPD). A divulgação a terceiros é expressamente proibida.';

// ---- render 1 página (HTML self-contained; vira PDF/Word pelo mesmo motor do relatório) ----
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function renderHTMLResumo(r) {
  const pos = r.situacao === 'Positiva';
  const cor = pos ? '#1b7a3d' : '#b3261e';
  const excl = (arr) => (arr.length ? arr.map((e) => `${esc(String(e.descricao).replace(/^\d[\d.]*\s*/, ''))} (R$ ${fmtBRL(e.valor)})`).join(' · ') : 'nenhuma');
  const linha = (lbl, val, obs) => `<tr><td class="lbl">${lbl}</td><td class="val">R$ ${fmtBRL(val)}</td><td class="obs">${obs || ''}</td></tr>`;
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
.info{margin:16px 0;padding:12px 16px;background:#f2f8f4;border-left:4px solid #1b7a3d;border-radius:4px;font-size:13px;line-height:1.5}
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
<div class="info">${esc(r.texto)}</div>
<div class="lgpd">${esc(r.lgpd)}</div>
</body></html>`;
}

// ---- orquestração (busca da API + calcula) ----
// deps injetável ({ balancete, caixa }) para teste sem rede.
export async function montarResumoFinanceiro({ idCondominio, ano, mes, nomeCondominio }, deps = {}) {
  const _balancete = deps.balancete || balancete;
  const _caixa = deps.caixa || caixa;
  const { dtInicio, dtFim } = periodoMes(ano, mes);
  const [bal, cx] = await Promise.all([_balancete(idCondominio, dtInicio, dtFim), _caixa(idCondominio, dtInicio, dtFim)]);
  const itens = bal.itens || bal; // balancete() devolve {nomeplanocontas, itens}
  const resumo = calcularResumo(itens, cx);
  return {
    condominio: nomeCondominio || bal.nomeplanocontas || '',
    periodo: { mes: Number(mes), ano: Number(ano), rotulo: `${nomeMes(mes)}/${ano}` },
    ...resumo,
    texto: textoInformativo(resumo, mes),
    lgpd: RODAPE_LGPD,
  };
}
