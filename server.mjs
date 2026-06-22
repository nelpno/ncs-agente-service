// server.mjs — webhook do Octadesk + chat de teste (/chat) com código de acesso.
import http from 'node:http';
import { config } from './src/config.mjs';
import { getSession } from './src/memory.mjs';
import { handleTurn } from './src/agent.mjs';
import { responder } from './src/octadesk.mjs';
import { sinalCobranca } from './src/cobranca.mjs';

function readBody(req) { return new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d)); }); }
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }

function parsePayload(p) {
  const text = p?.message?.text || p?.message || p?.text || p?.content || p?.body?.text || p?.event?.message?.text || '';
  const chatId = p?.chatId || p?.chat?.id || p?.id || p?.roomId || p?.room?.id || null;
  const fluxo = { botid: p?.botid || p?.botId || p?.bot?.id, componentid: p?.componentid || p?.componentId, roomkey: p?.roomkey || p?.roomKey };
  const sessionKey = String(fluxo.roomkey || chatId || p?.contact?.id || 'anon');
  return { text: typeof text === 'string' ? text : '', chatId, fluxo, sessionKey };
}

const CHAT_HTML = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ana — Agente NCS (teste)</title><style>
*{box-sizing:border-box;font-family:'Segoe UI',Arial,sans-serif}
body{margin:0;background:#e5ddd5;height:100vh;display:flex;flex-direction:column}
header{background:#075e54;color:#fff;padding:12px 16px;display:flex;align-items:center;gap:10px}
header b{flex:1} header small{opacity:.85;font-weight:normal}
button{background:#fff;color:#075e54;border:none;padding:6px 12px;border-radius:16px;cursor:pointer;font-weight:600}
#chat{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px}
.b{max-width:78%;padding:8px 12px;border-radius:10px;white-space:pre-wrap;line-height:1.35;font-size:15px;box-shadow:0 1px 1px rgba(0,0,0,.1)}
.me{align-self:flex-end;background:#dcf8c6} .ana{align-self:flex-start;background:#fff}
.sys{align-self:center;background:#ffe0b2;color:#5a3210;font-size:13px;border-radius:8px;text-align:center}
.typing{align-self:flex-start;color:#888;font-style:italic;font-size:14px}
footer{display:flex;padding:10px;gap:8px;background:#f0f0f0}
input{flex:1;padding:11px 14px;border:1px solid #ccc;border-radius:20px;font-size:15px;outline:none}
#send{background:#075e54;color:#fff;border-radius:20px;padding:0 18px}
</style></head><body>
<header><b>Ana — Agente NCS <small>(ambiente de teste)</small></b><button onclick="reset()">Nova conversa</button></header>
<div id="chat"></div>
<footer><input id="msg" placeholder="Escreva como um condomino (ex.: quero a 2a via, sou do condominio X, CPF ...)" autocomplete="off"><button id="send" onclick="send()">Enviar</button></footer>
<script>
const params=new URLSearchParams(location.search); const K=params.get('k')||'';
let session='web-'+Math.random().toString(36).slice(2);
const chat=document.getElementById('chat'), inp=document.getElementById('msg');
function add(text,cls){const d=document.createElement('div');d.className='b '+cls;d.textContent=text;chat.appendChild(d);chat.scrollTop=chat.scrollHeight;return d;}
function reset(){session='web-'+Math.random().toString(36).slice(2);chat.replaceChildren();add('Ambiente de teste do agente. Fale como um condomino. (Le dados reais; informe o condominio junto do CPF.)','sys');}
async function send(){
  const t=inp.value.trim(); if(!t)return; inp.value='';
  add(t,'me'); const typing=add('Ana esta digitando...','typing'); const t0=Date.now();
  try{
    const r=await fetch('/chat-send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:t,session,k:K})});
    const j=await r.json(); typing.remove();
    if(r.status===401){add('Codigo de acesso invalido. Use o link completo que voce recebeu.','sys');return;}
    add(j.reply||'(sem resposta)','ana');
    if(j.transferred) add('Encaminhado para um atendente humano.','sys');
    const m=add('tempo: '+((Date.now()-t0)/1000).toFixed(1)+'s','sys'); m.style.background='transparent'; m.style.color='#888'; m.style.fontSize='11px';
  }catch(e){typing.remove();add('Erro: '+e.message,'sys');}
}
inp.addEventListener('keydown',function(e){if(e.key==='Enter')send();});
reset();
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true, model: config.agentModel });

    // chat de teste (HTML)
    if (req.method === 'GET' && req.url.startsWith('/chat') && !req.url.startsWith('/chat-send')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(CHAT_HTML);
    }
    // chat-send (mesmo serviço, protegido por código)
    if (req.method === 'POST' && req.url.startsWith('/chat-send')) {
      const data = JSON.parse((await readBody(req)) || '{}');
      if (config.chatPasscode && data.k !== config.chatPasscode) return json(res, 401, { reply: 'código inválido' });
      const session = getSession('chat-' + (data.session || 'anon'));
      const r = await handleTurn(session, data.message || '', { chatId: null, fluxo: {}, transferred: null });
      return json(res, 200, { reply: r.reply, transferred: !!r.transferred });
    }

    // webhook Octadesk
    if (req.method !== 'POST' || !req.url.startsWith('/webhook')) return json(res, 404, { erro: 'not found' });
    if (config.webhookSecret) {
      const got = req.headers['x-webhook-secret'] || (req.headers['authorization'] || '').replace(/^Bearer /, '');
      if (got !== config.webhookSecret) return json(res, 401, { erro: 'unauthorized' });
    }
    const raw = await readBody(req);
    let payload = {}; try { payload = JSON.parse(raw || '{}'); } catch {}
    const { text, chatId, fluxo, sessionKey } = parsePayload(payload);
    console.log(`[webhook] keys=${Object.keys(payload).join(',')} chatId=${chatId} len=${text.length}`);
    if (!text) return json(res, 200, { reply: '', nota: 'sem texto' });
    const session = getSession(sessionKey);
    const ctx = { chatId, fluxo, transferred: null };
    const { reply, transferred } = await handleTurn(session, text, ctx);
    // detalhes do handoff p/ o fluxo do Octadesk rotear ao time certo: motivo + resumo (+ escritório de cobrança no roteamento).
    let roteamento = null;
    if (transferred?.motivo) { try { roteamento = sinalCobranca(transferred.motivo, { id_condominio: ctx.lastCondo?.id, nome: ctx.lastCondo?.nome })?.roteamento || null; } catch {} }
    if (reply && chatId) { try { await responder(chatId, reply); } catch (e) { console.warn('[webhook] responder falhou:', e.message); } }
    return json(res, 200, { reply, transferred: !!transferred, motivo: transferred?.motivo || null, resumo: transferred?.resumo || null, roteamento });
  } catch (e) {
    console.error('[srv] erro:', e.message);
    return json(res, 200, { reply: 'Tive um problema aqui, vou te encaminhar para um atendente.', erro: true });
  }
});
server.listen(config.port, () => console.log(`[ncs-agente] ouvindo :${config.port} | modelo ${config.agentModel} | dryRun=${config.dryRunWrites} | chat=${config.chatPasscode ? 'on' : 'off'}`));
