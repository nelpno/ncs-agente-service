// server.mjs — webhook do Octadesk ("Conecte a outro sistema") → roda o agente → responde.
import http from 'node:http';
import { config } from './src/config.mjs';
import { getSession } from './src/memory.mjs';
import { handleTurn } from './src/agent.mjs';
import { responder } from './src/octadesk.mjs';

function readBody(req) {
  return new Promise((resolve) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => resolve(d)); });
}
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }

// Extrai os campos do payload do Octadesk de forma defensiva (o shape exato a gente confirma no 1º teste).
function parsePayload(p) {
  const text = p?.message?.text || p?.message || p?.text || p?.content || p?.body?.text || p?.event?.message?.text || '';
  const chatId = p?.chatId || p?.chat?.id || p?.id || p?.roomId || p?.room?.id || null;
  const fluxo = { botid: p?.botid || p?.botId || p?.bot?.id, componentid: p?.componentid || p?.componentId, roomkey: p?.roomkey || p?.roomKey };
  const sessionKey = String(fluxo.roomkey || chatId || p?.contact?.id || 'anon');
  return { text: typeof text === 'string' ? text : '', chatId, fluxo, sessionKey };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true, model: config.agentModel });
    if (req.method !== 'POST' || !req.url.startsWith('/webhook')) return json(res, 404, { erro: 'not found' });

    // segredo compartilhado (o fluxo do Octadesk manda no header)
    if (config.webhookSecret) {
      const got = req.headers['x-webhook-secret'] || req.headers['authorization']?.replace(/^Bearer /, '');
      if (got !== config.webhookSecret) return json(res, 401, { erro: 'unauthorized' });
    }

    const raw = await readBody(req);
    let payload = {}; try { payload = JSON.parse(raw || '{}'); } catch {}
    const { text, chatId, fluxo, sessionKey } = parsePayload(payload);
    console.log(`[webhook] keys=${Object.keys(payload).join(',')} chatId=${chatId} len=${text.length}`); // estrutura, não PII

    if (!text) return json(res, 200, { reply: '', nota: 'sem texto' });

    const session = getSession(sessionKey);
    const ctx = { chatId, fluxo, transferred: null };
    const { reply, transferred } = await handleTurn(session, text, ctx);

    // entrega a resposta no chat (se temos chatId). O retorno HTTP também leva o reply (o fluxo pode usar).
    if (reply && chatId) { try { await responder(chatId, reply); } catch (e) { console.warn('[webhook] responder falhou:', e.message); } }
    return json(res, 200, { reply, transferred: !!transferred });
  } catch (e) {
    console.error('[webhook] erro:', e.message);
    return json(res, 200, { reply: 'Tive um problema aqui, vou te encaminhar para um atendente.', erro: true });
  }
});
server.listen(config.port, () => console.log(`[ncs-agente] ouvindo :${config.port} | modelo ${config.agentModel} | dryRun=${config.dryRunWrites}`));
