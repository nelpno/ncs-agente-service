// llm.mjs — chamada ao modelo (OpenAI-compatible, com tool-calling) + RESERVA cross-provider.
import { config } from './config.mjs';

// Timeout por requisição ao modelo. SEM isto, um request "pendurado" nunca resolve/rejeita → o turno trava p/ sempre
// → /chat-send nunca responde → o adapter do Chatwoot não posta nada (= "parou de responder", feedback Fernando 28/06).
// Com AbortSignal.timeout, um stall vira erro → retry → no pior caso o server devolve o fallback gracioso.
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 75000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// RESERVA cross-provider: se o provedor primário (OpenAI) falhar de vez — conta SEM CRÉDITO (429 em TODA chamada,
// incidente 07/07: Ana + Estagiário caíram juntos) ou 429 de capacidade — cai pro Gemini (conta/faturamento Google
// SEPARADO) p/ os bots não ficarem mudos. Reserva no gpt-5.1 NÃO serviria: é a MESMA conta OpenAI → morre junto.
// Só dispara quando o primário esgota os retries. Se a reserva também falhar, propaga o erro (server = msg graciosa).
const FB_KEY = process.env.FALLBACK_API_KEY || process.env.GEMINI_API_KEY || '';
const FB_BASE = process.env.FALLBACK_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai';
const FB_MODEL = process.env.FALLBACK_MODEL || 'gemini-2.5-flash';

// Uma tentativa (com N attempts internos) contra UM provedor. Monta o body no formato certo por base URL.
async function callProvider({ base, key, model, messages, tools, maxTokens, temperature, reasoningEffort, cacheKey, attempts }) {
  // API DIRETA da OpenAI difere do resto: gpt-5.x exige `max_completion_tokens` (rejeita `max_tokens`) e SÓ aceita
  // `temperature=1` (default) — enviar temperature=0.2 dá HTTP 400. Gemini/OpenRouter usam max_tokens + temperature.
  const openaiDirect = /(^|\/\/)api\.openai\.com/i.test(base);
  const body = { model, messages };
  if (openaiDirect) {
    body.max_completion_tokens = maxTokens; // não enviar temperature: gpt-5.x só aceita o default (1)
    // prompt_cache_key: aumenta a "stickiness" de roteamento do cache de prefixo da OpenAI (mesma chave → mesmo backend
    // → reusa o KV do prefixo system+tools). Chave POR CONVERSA (não global): a doc limita ~15 req/min por chave, e uma
    // conversa fica abaixo disso; o prefixo do bot (config.promptCacheKey) evita colisão Ana×Estagiário na mesma conta.
    const ck = [config.promptCacheKey, cacheKey].filter(Boolean).join(':');
    if (ck) body.prompt_cache_key = ck;
  } else {
    body.temperature = temperature;
    // maxTokens é um CAP (não alvo): thinking do gemini consome orçamento e, com teto baixo, devolve resposta VAZIA.
    body.max_tokens = maxTokens;
  }
  if (tools?.length) body.tools = tools;
  // reasoning_effort 'none' é ESPECÍFICO do Gemini; modelos de reasoning da OpenAI rejeitam → não enviar p/ não-Gemini.
  let eff = reasoningEffort;
  if (eff === 'none' && !/gemini/i.test(model)) eff = null;
  if (eff) body.reasoning_effort = eff;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://gruponcs.net',
          'X-Title': 'NCS Agente',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      });
      if (r.status === 429 || r.status >= 500) { lastErr = new Error('HTTP ' + r.status); if (i < attempts - 1) await sleep(800 * 2 ** i); continue; }
      if (!r.ok) throw new Error(`LLM ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = await r.json();
      const m = j.choices?.[0]?.message || {};
      // extra_content carrega o `thought_signature` do gemini-3: PRECISA voltar nas mensagens do assistant senão o
      // modelo (thinking) "perde o fio" após um tool-call e devolve conteúdo VAZIO (raiz do blip "não consegui processar").
      return { content: m.content || '', tool_calls: m.tool_calls || null, extra_content: m.extra_content || null, usage: j.usage || {} };
    } catch (e) { lastErr = e; if (i < attempts - 1) await sleep(800 * 2 ** i); }
  }
  throw lastErr;
}

export async function chat({ messages, tools, temperature = 0.2, maxTokens = 1500, retries = 3, reasoningEffort, cacheKey } = {}) {
  // AGENT_REASONING_EFFORT (env) força um nível em TODAS as chamadas (tuning); o agent passa 'none' SÓ na re-tentativa de vazio do gemini-3.
  const primaryEffort = process.env.AGENT_REASONING_EFFORT || reasoningEffort || null;
  try {
    return await callProvider({ base: config.openrouterBase, key: config.openrouterKey, model: config.agentModel, messages, tools, maxTokens, temperature, reasoningEffort: primaryEffort, cacheKey, attempts: retries + 1 });
  } catch (primErr) {
    if (!FB_KEY) throw primErr; // sem reserva configurada → comportamento antigo (erro → msg graciosa)
    console.warn('[fallback] primário (' + config.agentModel + ') falhou: ' + primErr.message + ' — usando reserva ' + FB_MODEL);
    try {
      const out = await callProvider({ base: FB_BASE, key: FB_KEY, model: FB_MODEL, messages, tools, maxTokens, temperature, reasoningEffort: null, cacheKey, attempts: 2 });
      return { ...out, fallback: FB_MODEL };
    } catch (fbErr) {
      console.error('[fallback] reserva (' + FB_MODEL + ') também falhou: ' + fbErr.message);
      throw primErr; // preserva o erro do primário
    }
  }
}
