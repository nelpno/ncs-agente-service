// llm.mjs — chamada ao modelo via OpenRouter (OpenAI-compatible, com tool-calling).
import { config } from './config.mjs';

// maxTokens 1500 (não 900): o gemini-3-flash usa "thinking" que consome o orçamento e, com teto baixo, devolve
// resposta VAZIA → cai no fallback "não consegui processar" (blip intermitente, ~1/3 em turnos com várias tools).
// É um CAP, não alvo — não deixa a Ana mais verbosa; só evita truncar. Validado 21/06 (cenário de débito completo).
export async function chat({ messages, tools, temperature = 0.2, maxTokens = 1500, retries = 3 }) {
  const body = { model: config.agentModel, messages, temperature, max_tokens: maxTokens };
  if (tools?.length) body.tools = tools;
  // ⚠️ NÃO desligar o thinking globalmente (reasoning_effort:none/low): testado 21/06, melhora ~10% o blip do débito
  // mas QUEBRA negociação/regimento/mudança (cenários que dependem de raciocínio de tool). Thinking completo é o melhor no geral.
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(`${config.openrouterBase}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.openrouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://gruponcs.net',
          'X-Title': 'NCS Agente',
        },
        body: JSON.stringify(body),
      });
      if (r.status === 429 || r.status >= 500) { lastErr = new Error('HTTP ' + r.status); await sleep(800 * 2 ** i); continue; }
      if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = await r.json();
      const m = j.choices?.[0]?.message || {};
      // extra_content carrega o `thought_signature` do gemini-3: PRECISA voltar nas mensagens do assistant senão o
      // modelo (thinking) "perde o fio" após um tool-call e devolve conteúdo VAZIO (raiz do blip "não consegui processar").
      return { content: m.content || '', tool_calls: m.tool_calls || null, extra_content: m.extra_content || null, usage: j.usage || {} };
    } catch (e) { lastErr = e; if (i < retries) await sleep(800 * 2 ** i); }
  }
  throw lastErr;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
