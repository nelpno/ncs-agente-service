// Texto executivo: o LLM SÓ redige prosa SOBRE os números já calculados (nunca inventa/recalcula valor).
// Recebe o modelo agregado (todos os números reais) e devolve 1-2 parágrafos em PT-BR p/ um síndico leigo.
// Se não houver chave de LLM ou a chamada falhar, cai num resumo DETERMINÍSTICO montado a partir dos números.

const brl = v => v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = v => v == null ? '—' : (v >= 0 ? '+' : '') + Number(v).toFixed(1) + '%';

// ---- resumo determinístico (fallback, 100% sem LLM) ----
export function resumoDeterministico(m) {
  const p = [];
  const res = m.resultado;
  p.push(
    `Em ${m.periodo.label}, o condomínio ${m.condominio?.nome || ''} registrou receitas de ${brl(m.receitas.total)} ` +
    `e despesas de ${brl(m.despesas.total)}, resultando em ${res.tipo === 'superavit' ? 'um superávit' : 'um déficit'} de ${brl(Math.abs(res.valor))}.`
  );
  if (m.despesas.previsto != null) {
    const dif = m.despesas.total - m.despesas.previsto;
    p.push(
      `As despesas ficaram ${dif <= 0 ? 'dentro do previsto' : 'acima do previsto'} ` +
      `(previsão de ${brl(m.despesas.previsto)}, realizado de ${brl(m.despesas.total)}).`
    );
  }
  if (m.alertas.length) {
    p.push(
      `Atenção: ${m.alertas.map(a => `${a.categoria} ficou ${pct(a.excedentePct)} acima do orçado`).join('; ')}.`
    );
  }
  p.push(
    `A posição de caixa fechou o mês em ${brl(m.caixa.saldoFinal)}. ` +
    (m.inadimplencia.qtd ? `A inadimplência soma ${brl(m.inadimplencia.total)} em ${m.inadimplencia.qtd} unidade(s).` : `Não há inadimplência registrada no período.`)
  );
  return { resumo: p.join(' '), fonte: 'deterministico' };
}

// bloco de FATOS entregue ao LLM — apenas números já apurados
function fatos(m) {
  return {
    condominio: m.condominio?.nome,
    periodo: m.periodo.label,
    receitas_total: m.receitas.total,
    receitas_previsto: m.receitas.previsto,
    despesas_total: m.despesas.total,
    despesas_previsto: m.despesas.previsto,
    resultado: m.resultado.valor,
    resultado_tipo: m.resultado.tipo,
    maiores_despesas: m.despesas.categorias.slice(0, 4).map(c => ({ categoria: c.descricao, valor: c.valor })),
    alertas_estouro: m.alertas.map(a => ({ categoria: a.categoria, previsto: a.previsto, realizado: a.realizado, acima_pct: Number(a.excedentePct.toFixed(1)) })),
    caixa: { saldo_inicial: m.caixa.saldoInicial, entradas: m.caixa.entradas, saidas: m.caixa.saidas, saldo_final: m.caixa.saldoFinal },
    inadimplencia: { unidades: m.inadimplencia.qtd, total: m.inadimplencia.total },
    comparativo_mes_anterior: m.comparativo ? {
      receitas_var_pct: m.comparativo.receitas.varPct, despesas_var_pct: m.comparativo.despesas.varPct,
    } : null,
  };
}

const SYS = 'Você é um contador que escreve o resumo executivo da prestação de contas mensal de um condomínio para o SÍNDICO, que NÃO é técnico. ' +
  'Regras: use SOMENTE os números do bloco FATOS (não invente nem recalcule valores; se um número não estiver nos fatos, não cite). ' +
  'Escreva 2 parágrafos curtos, em português claro e direto, explicando o resultado do mês e o PORQUÊ (o que puxou para cima/baixo), ' +
  'e, se houver alertas de estouro de orçamento, diga em linguagem simples o que observar. Não use markdown, títulos nem bullet. Valores em reais (R$).';
const userPrompt = m => 'FATOS (JSON):\n' + JSON.stringify(fatos(m), null, 1);

// textoExecutivo(m, { chat, log })
//  - `chat`: cliente LLM injetado (ex.: o llm.mjs da Ana/Estagiário, robusto p/ Gemini). Preferido no container.
//  - sem `chat`: chamada direta via env (CLI standalone).
export async function textoExecutivo(m, { chat, log } = {}) {
  if (typeof chat === 'function') {
    try {
      const res = await chat({ messages: [{ role: 'system', content: SYS }, { role: 'user', content: userPrompt(m) }], maxTokens: 900 });
      const txt = (res?.content || '').trim();
      if (!txt) throw new Error('conteúdo vazio do chat injetado');
      return { resumo: txt, fonte: 'llm:chat' };
    } catch (e) { log?.(`[texto-executivo] chat injetado falhou (${e.message}) → fallback`); return resumoDeterministico(m); }
  }

  const KEY = process.env.RELATORIO_LLM_KEY || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!KEY) return resumoDeterministico(m);
  const BASE = process.env.RELATORIO_LLM_BASE || process.env.OPENROUTER_BASE_URL || 'https://api.openai.com/v1';
  const MODEL = process.env.RELATORIO_MODEL || process.env.AGENT_MODEL || 'gpt-5.4';
  const openaiDirect = /openai\.com/.test(BASE) || /^gpt-5/.test(MODEL);

  const body = { model: MODEL, messages: [{ role: 'system', content: SYS }, { role: 'user', content: userPrompt(m) }] };
  if (openaiDirect) body.max_completion_tokens = 800; // gpt-5.x: exige este campo e temperature=1 (default)
  else { body.max_tokens = 1200; body.temperature = 0.3; if (/gemini/i.test(MODEL)) body.reasoning_effort = 'none'; } // gemini: desliga thinking p/ não truncar

  try {
    const r = await fetch(`${BASE.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS || 40000)),
    });
    const j = await r.json();
    const txt = j?.choices?.[0]?.message?.content?.trim();
    if (!txt) throw new Error('resposta vazia do LLM: ' + JSON.stringify(j).slice(0, 160));
    return { resumo: txt, fonte: `llm:${MODEL}` };
  } catch (e) {
    log?.(`[texto-executivo] LLM falhou (${e.message}) → fallback determinístico`);
    return resumoDeterministico(m);
  }
}
