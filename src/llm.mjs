// llm.mjs — chamada ao modelo via OpenRouter (OpenAI-compatible, com tool-calling).
import { config } from './config.mjs';

export async function chat({ messages, tools, temperature = 0.2, maxTokens = 900, retries = 3 }) {
  const body = { model: config.agentModel, messages, temperature, max_tokens: maxTokens };
  if (tools?.length) body.tools = tools;
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
      return { content: m.content || '', tool_calls: m.tool_calls || null, usage: j.usage || {} };
    } catch (e) { lastErr = e; if (i < retries) await sleep(800 * 2 ** i); }
  }
  throw lastErr;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
