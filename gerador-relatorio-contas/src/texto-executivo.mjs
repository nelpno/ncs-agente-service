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

// ---------------------------------------------------------------------------
// PERÍODO (jan→mai) — resumo executivo consolidado
// ---------------------------------------------------------------------------
function fatosPeriodo(m) {
  return {
    condominio: m.condominio?.nome, periodo: m.periodo.label, meses: m.periodo.nMeses,
    receitas_total: m.receitas.total, receitas_media_mensal: Math.round(m.receitas.media),
    despesas_total: m.despesas.total, despesas_media_mensal: Math.round(m.despesas.media),
    resultado_acumulado: m.resultado.valor, resultado_medio_mensal: Math.round(m.resultado.media),
    meses_com_superavit: m.resultado.mesesPositivos, meses_com_deficit: m.resultado.mesesNegativos,
    resultado_por_mes: m.porMes.map(x => ({ mes: x.mesNome, resultado: Math.round(x.resultado) })),
    maiores_despesas_acumuladas: m.despesas.categorias.slice(0, 5).map(c => ({ categoria: c.descricao, total: c.valor })),
    alertas_estouro: m.alertas.map(a => ({ categoria: a.categoria, acima_pct: Number(a.excedentePct.toFixed(1)) })),
    caixa_saldo_final: m.caixa.saldoFinal,
    inadimplencia: { unidades: m.inadimplencia.qtd, total: m.inadimplencia.total },
  };
}

export function resumoDeterministicoPeriodo(m) {
  const p = [];
  const res = m.resultado;
  p.push(`No período de ${m.periodo.label} (${m.periodo.nMeses} meses), o condomínio ${m.condominio?.nome || ''} teve receitas de ${brl(m.receitas.total)} ` +
    `e despesas de ${brl(m.despesas.total)}, com ${res.tipo === 'superavit' ? 'superávit' : 'déficit'} acumulado de ${brl(Math.abs(res.valor))} ` +
    `(média de ${brl(m.resultado.media)} por mês).`);
  p.push(`O resultado foi positivo em ${res.mesesPositivos} de ${m.periodo.nMeses} meses. ` +
    `As maiores despesas do período foram ${m.despesas.categorias.slice(0, 3).map(c => c.descricao).join(', ')}. ` +
    `O caixa fechou o período em ${brl(m.caixa.saldoFinal)}` +
    (m.inadimplencia.qtd ? ` e há ${brl(m.inadimplencia.total)} em inadimplência (${m.inadimplencia.qtd} unidades).` : ' e não há inadimplência registrada.'));
  return { resumo: p.join(' '), fonte: 'deterministico' };
}

const SYS_PERIODO = 'Você é um contador que escreve o resumo executivo de um período (vários meses) da prestação de contas de um condomínio para o SÍNDICO, que NÃO é técnico. ' +
  'Use SOMENTE os números do bloco FATOS (não invente nem recalcule). Escreva 2 parágrafos curtos em português claro: ' +
  '(1) como o período fechou no total (receitas, despesas, resultado acumulado e média mensal); ' +
  '(2) a TENDÊNCIA ao longo dos meses (melhorou ou piorou, quantos meses fecharam positivos) e o que mais pesou nas despesas. Sem markdown, sem títulos, sem bullet. Valores em R$.';

export async function textoExecutivoPeriodo(m, { chat, log } = {}) {
  const user = 'FATOS (JSON):\n' + JSON.stringify(fatosPeriodo(m), null, 1);
  if (typeof chat === 'function') {
    try {
      const res = await chat({ messages: [{ role: 'system', content: SYS_PERIODO }, { role: 'user', content: user }], maxTokens: 900 });
      const txt = (res?.content || '').trim();
      if (!txt) throw new Error('vazio');
      return { resumo: txt, fonte: 'llm:chat' };
    } catch (e) { log?.(`[texto-periodo] chat falhou (${e.message}) → fallback`); return resumoDeterministicoPeriodo(m); }
  }
  return resumoDeterministicoPeriodo(m);
}

// ---------------------------------------------------------------------------
// RECOMENDAÇÃO (advisory) — consultor de gestão sobre os números do período
// ---------------------------------------------------------------------------
export function recomendacaoDeterministica(m) {
  const p = [];
  const deficitRecorrente = m.resultado.mesesNegativos >= Math.ceil(m.periodo.nMeses / 2);
  if (m.resultado.valor < 0 || deficitRecorrente) {
    p.push(`O resultado acumulado é ${m.resultado.valor < 0 ? 'deficitário' : 'apertado'} (${brl(m.resultado.media)}/mês em média). ` +
      `Vale a assembleia avaliar um reajuste da taxa condominial e/ou a revisão das maiores despesas.`);
  } else {
    p.push(`O período fechou equilibrado (superávit médio de ${brl(m.resultado.media)}/mês). A recomendação é manter a taxa atual e monitorar as despesas.`);
  }
  const top = m.despesas.categorias.slice(0, 2).map(c => c.descricao).join(' e ');
  if (top) p.push(`As despesas que mais pesam (${top}) são as primeiras a revisar caso se busque redução de custos.`);
  if (m.alertas.length) p.push(`Categorias acima do orçado no período: ${m.alertas.map(a => a.categoria).join(', ')} — merecem atenção.`);
  if (m.inadimplencia.qtd) p.push(`A inadimplência (${brl(m.inadimplencia.total)} em ${m.inadimplencia.qtd} unidades) reduz o caixa disponível; intensificar a régua de cobrança ajuda o equilíbrio.`);
  p.push('Estas são sugestões de apoio à gestão — a decisão final é do síndico/assembleia.');
  return { resumo: p.join(' '), fonte: 'deterministico' };
}

const SYS_RECOM = 'Você é um consultor de gestão condominial. A partir dos NÚMEROS já apurados de um condomínio (bloco FATOS), escreva uma RECOMENDAÇÃO objetiva para o síndico. ' +
  'Regras: use só os números dos FATOS (não invente valores). Aborde, quando fizer sentido: (a) equilíbrio receitas×despesas e se cabe reajuste da taxa ou manter; ' +
  '(b) 1 a 2 categorias de despesa a revisar para reduzir custo; (c) inadimplência; (d) tendência. ' +
  'Seja concreto e prático (3 a 5 frases ou tópicos curtos). SEMPRE termine deixando claro que é uma SUGESTÃO de apoio e que a decisão é do síndico/assembleia. Português claro, sem jargão, sem markdown pesado.';

export async function textoRecomendacao(m, { chat, log } = {}) {
  const user = 'FATOS (JSON):\n' + JSON.stringify(fatosPeriodo(m), null, 1);
  if (typeof chat === 'function') {
    try {
      const res = await chat({ messages: [{ role: 'system', content: SYS_RECOM }, { role: 'user', content: user }], maxTokens: 1000 });
      const txt = (res?.content || '').trim();
      if (!txt) throw new Error('vazio');
      return { resumo: txt, fonte: 'llm:chat' };
    } catch (e) { log?.(`[recomendacao] chat falhou (${e.message}) → fallback`); return recomendacaoDeterministica(m); }
  }
  return recomendacaoDeterministica(m);
}
