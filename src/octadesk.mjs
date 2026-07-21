// octadesk.mjs — ações reais no Octadesk: responder, marcar tag, encaminhar pra humano.
// Auth: X-API-KEY + header octa-agent-email. Base e creds no config.
import { config } from './config.mjs';
import { sinalCobranca } from './cobranca.mjs';

function headers() {
  const h = { 'X-API-KEY': config.octaKey, 'Content-Type': 'application/json' };
  if (config.octaAgentEmail) h['octa-agent-email'] = config.octaAgentEmail;
  return h;
}
// Timeout (env OCTA_TIMEOUT_MS, default 20s): um POST pendurado no Octadesk não pode travar o turno p/ sempre.
const OCTA_TIMEOUT_MS = Number(process.env.OCTA_TIMEOUT_MS || 20000);
async function octa(method, path, body) {
  const r = await fetch(`${config.octaBase}${path}`, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(OCTA_TIMEOUT_MS) });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Octadesk ${method} ${path} ${r.status}: ${txt.slice(0, 160)}`);
  try { return JSON.parse(txt); } catch { return txt; }
}

// Lista tickets (GET /tickets) — leitura PASSIVA usada pelo espelho (fase 0 da saída do Octadesk).
// Não altera nada no Octadesk. Normaliza a resposta (o payload pode vir como array ou {data:[...]}).
export async function listarTickets({ limit = 50, page = 1 } = {}) {
  const j = await octa('GET', `/tickets?limit=${limit}&page=${page}`);
  const arr = Array.isArray(j) ? j : (j?.data || j?.items || j?.tickets || []);
  return Array.isArray(arr) ? arr : [];
}

// Responder no chat aberto (POST /chat/{id}/messages)
export async function responder(chatId, texto) {
  return octa('POST', `/chat/${chatId}/messages`, { message: { text: texto }, type: 'text' });
}
// Envia um arquivo de uma URL pública como ANEXO no chat (baixa → base64 → POST /chat/{id}/messages).
// Usado p/ o PDF da 2ª via do boleto: a URL do PDF é pública (Superlógica), mas o campo `url` do Octadesk exige
// bucket próprio → mandamos em base64 (AttachmentSend: name+base64+mimeType, sem a restrição de bucket).
// Aborta se o conteúdo não for PDF (evita mandar HTML como se fosse boleto).
// ⚠️ Formato do corpo conforme a OpenAPI pública (type:'public'+body+attachments). A instância da NCS
// (api002.octadesk.services) pode esperar outro envelope (ver responder() usa {message:{text},type:'text'}) —
// CONFIRMAR no 1º teste real; se 400, alinhar o envelope com o que o /chat/{id}/messages aceita lá.
export async function enviar_anexo_url({ chatId, sourceUrl, filename, mimeType = 'application/pdf', body = '' }) {
  const r = await fetch(sourceUrl, { redirect: 'follow', signal: AbortSignal.timeout(OCTA_TIMEOUT_MS) });
  if (!r.ok) throw new Error(`download anexo ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (mimeType === 'application/pdf' && !buf.slice(0, 5).toString('latin1').startsWith('%PDF')) {
    throw new Error('conteúdo baixado não é PDF');
  }
  const base64 = buf.toString('base64');
  return octa('POST', `/chat/${chatId}/messages`, {
    type: 'public',
    ...(body ? { body } : {}),
    attachments: [{ name: filename, base64, mimeType }],
  });
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
// Encaminhar pra humano: marca tag(s) de roteamento + sinaliza pelo external-webhook.
// O COMPONENTE DE TRANSFERÊNCIA do fluxo (montado 1× na Fase 0) faz o handoff de fato.
// Em motivo de COBRANÇA, anexa o destino resolvido (garantidora→escritório→gerência) via sinalCobranca:
// uma 2ª tag determinística (`cobranca-<slug>`) + o objeto `roteamento` no sinal, p/ o fluxo rotear ao escritório certo.
export async function transferir_humano({ chatId, motivo, resumo, fluxo, id_condominio, nome }) {
  const baseTag = `ia-transferir-${(motivo || 'humano').replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`;
  const sinal = sinalCobranca(motivo, { id_condominio, nome }); // null quando o motivo NÃO é de cobrança
  const tags = sinal ? [baseTag, sinal.tag] : [baseTag];
  try { await octa('PUT', `/chat/${chatId}/tags`, { tags }); } catch (e) { console.warn('[octadesk] tag falhou:', e.message); }
  if (fluxo?.botid && fluxo?.componentid && fluxo?.roomkey) {
    const body = { action: 'transfer', motivo, resumo, ...(sinal ? { roteamento: sinal.roteamento } : {}) };
    try { await externalWebhookReply({ ...fluxo, body }); } catch (e) { console.warn('[octadesk] external-webhook transfer falhou:', e.message); }
  }
  return { transferido: true, motivo, tags, ...(sinal ? { roteamento: sinal.roteamento } : {}) };
}
