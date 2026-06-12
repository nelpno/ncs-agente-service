// octadesk.mjs — ações reais no Octadesk: responder, marcar tag, encaminhar pra humano.
// Auth: X-API-KEY + header octa-agent-email. Base e creds no config.
import { config } from './config.mjs';

function headers() {
  const h = { 'X-API-KEY': config.octaKey, 'Content-Type': 'application/json' };
  if (config.octaAgentEmail) h['octa-agent-email'] = config.octaAgentEmail;
  return h;
}
async function octa(method, path, body) {
  const r = await fetch(`${config.octaBase}${path}`, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Octadesk ${method} ${path} ${r.status}: ${txt.slice(0, 160)}`);
  try { return JSON.parse(txt); } catch { return txt; }
}

// Responder no chat aberto (POST /chat/{id}/messages)
export async function responder(chatId, texto) {
  return octa('POST', `/chat/${chatId}/messages`, { message: { text: texto }, type: 'text' });
}
// Marcar tag (PUT /chat/{id}/tags)
export async function marcar_tag(chatId, tag) {
  return octa('PUT', `/chat/${chatId}/tags`, { tags: [tag] });
}
// Responder de volta ao componente do fluxo "Conecte a outro sistema"
export async function externalWebhookReply({ botid, componentid, roomkey, body }) {
  const path = `/chat/external-webhook/${config.octaSubdomain}/${botid}/${componentid}/${roomkey}`;
  return octa('POST', path, body);
}
// Encaminhar pra humano: marca tag de roteamento + sinaliza pelo external-webhook.
// O COMPONENTE DE TRANSFERÊNCIA do fluxo (montado 1× na Fase 0) faz o handoff de fato.
export async function transferir_humano({ chatId, motivo, resumo, fluxo }) {
  const tag = `ia-transferir-${(motivo || 'humano').replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`;
  try { await marcar_tag(chatId, tag); } catch (e) { console.warn('[octadesk] tag falhou:', e.message); }
  if (fluxo?.botid && fluxo?.componentid && fluxo?.roomkey) {
    try { await externalWebhookReply({ ...fluxo, body: { action: 'transfer', motivo, resumo } }); } catch (e) { console.warn('[octadesk] external-webhook transfer falhou:', e.message); }
  }
  return { transferido: true, motivo, tag };
}
