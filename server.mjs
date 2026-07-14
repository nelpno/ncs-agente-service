// server.mjs — webhook do Octadesk + chat de teste (/chat) com código de acesso.
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { config } from './src/config.mjs';
import { getSession, saveSession } from './src/memory.mjs';
import { handleTurn } from './src/agent.mjs';
import { responder } from './src/octadesk.mjs';
import { sinalCobranca } from './src/cobranca.mjs';
import { servirPdf } from './src/cnd.mjs';

function readBody(req) { return new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d)); }); }
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }

function parsePayload(p) {
  const text = p?.message?.text || p?.message || p?.text || p?.content || p?.body?.text || p?.event?.message?.text || '';
  const chatId = p?.chatId || p?.chat?.id || p?.id || p?.roomId || p?.room?.id || null;
  const fluxo = { botid: p?.botid || p?.botId || p?.bot?.id, componentid: p?.componentid || p?.componentId, roomkey: p?.roomkey || p?.roomKey };
  const sessionKey = String(fluxo.roomkey || chatId || p?.contact?.id || 'anon');
  return { text: typeof text === 'string' ? text : '', chatId, fluxo, sessionKey };
}

// ── /write/aprovar · /write/rejeitar — executor único de escrita (Onda 1, spec §4.4) ───────────────
// O Portal (Estagiário) é UI; quem grava é o agente-service. Handlers PUROS (sem req/res do node):
// recebem o body já parseado + as funções do motor INJETADAS, devolvem {status, json}. Assim dá pra
// testar sem importar src/write/engine.mjs de verdade (que outro subagente ainda está migrando p/
// Supabase — aprovarRascunhoPorId pode não existir ainda quando este arquivo é lido).
export function criarHandlerAprovar({ aprovarRascunhoPorId } = {}) {
  return async function handlerAprovar(body) {
    const draftId = body?.draft_id;
    const aprovador = body?.aprovador;
    if (!draftId) return { status: 400, json: { ok: false, motivo: 'draft_id_obrigatorio' } };
    if (!aprovador) return { status: 400, json: { ok: false, motivo: 'aprovador_obrigatorio' } };
    if (typeof aprovarRascunhoPorId !== 'function') {
      return { status: 501, json: { ok: false, motivo: 'aprovarRascunhoPorId_indisponivel', detalhe: 'engine.mjs ainda não expõe aprovarRascunhoPorId(draftId, {aprovador, correcoes})' } };
    }
    let out;
    try { out = await aprovarRascunhoPorId(draftId, { aprovador, correcoes: body?.correcoes }); }
    catch (e) { return { status: 500, json: { ok: false, motivo: 'erro_interno', detalhe: e.message } }; }
    if (!out || out.ok !== true) {
      const motivo = out?.motivo || 'falha';
      const status = motivo === 'nao_encontrado' ? 404
        : (motivo === 'ja_rejeitado' || motivo === 'expirado') ? 409
        : motivo === 'invalido' ? 422
        : motivo === 'erro_gravacao' ? 502
        : 400;
      return { status, json: { ok: false, gravado: false, motivo, erros: out?.erros, detalhe: out?.detalhe } };
    }
    return { status: 200, json: { ok: true, gravado: !!out.gravado, dryRun: !!out.dryRun, jaGravado: !!out.jaGravado } };
  };
}

// Rejeição: o engine hoje só expõe rejeitarRascunho(token, ...) — não há variante por draft_id ainda.
// Aceita as duas formas: se vier draft_id e o engine já tiver rejeitarRascunhoPorId, usa; senão exige
// token e usa rejeitarRascunho. Se só vier draft_id e a variante por id não existir, sinaliza a
// pendência ao chamador (não inventa um comportamento) — ver item de dúvidas/bloqueios no relatório.
export function criarHandlerRejeitar({ rejeitarRascunhoPorId, rejeitarRascunho } = {}) {
  return async function handlerRejeitar(body) {
    const draftId = body?.draft_id;
    const token = body?.token;
    const aprovador = body?.aprovador;
    const motivo = body?.motivo;
    if (!aprovador) return { status: 400, json: { ok: false, motivo: 'aprovador_obrigatorio' } };
    let out;
    try {
      if (draftId && typeof rejeitarRascunhoPorId === 'function') {
        out = await rejeitarRascunhoPorId(draftId, { aprovador, motivo });
      } else if (token && typeof rejeitarRascunho === 'function') {
        out = await rejeitarRascunho(token, { aprovador, motivo });
      } else if (draftId) {
        return { status: 501, json: { ok: false, motivo: 'rejeitarRascunhoPorId_indisponivel', detalhe: 'engine.mjs só expõe rejeitarRascunho(token); passe "token" ou implemente a variante por draft_id' } };
      } else {
        return { status: 400, json: { ok: false, motivo: 'draft_id_ou_token_obrigatorio' } };
      }
    } catch (e) { return { status: 500, json: { ok: false, motivo: 'erro_interno', detalhe: e.message } }; }
    if (!out || out.ok !== true) {
      const m = out?.motivo || 'falha';
      const status = m === 'nao_encontrado' ? 404 : m === 'ja_gravado' ? 409 : 400;
      return { status, json: { ok: false, rejeitado: false, motivo: m } };
    }
    return { status: 200, json: { ok: true, rejeitado: !!out.rejeitado } };
  };
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
function reset(){session='web-'+Math.random().toString(36).slice(2);if(debTimer)clearTimeout(debTimer);debTimer=null;buf=[];waitMsg=null;chat.replaceChildren();add('Ambiente de teste do agente. Fale como um condomino. (Le dados reais; informe o condominio junto do CPF.) Empilhamento de baloes ativo (~'+(DEB/1000)+'s); ?deb=0 envia na hora.','sys');}
const DEB=(parseInt(params.get('deb'))||8)*1000; // janela p/ empilhar baloes (s); ?deb=0 envia na hora
let buf=[], debTimer=null, waitMsg=null;
function send(){
  const t=inp.value.trim(); if(!t)return; inp.value='';
  add(t,'me'); buf.push(t);
  if(DEB<=0){flush();return;}
  if(!waitMsg) waitMsg=add('(aguardando voce terminar...)','typing');
  if(debTimer) clearTimeout(debTimer);
  debTimer=setTimeout(flush,DEB);
}
async function flush(){
  if(debTimer){clearTimeout(debTimer);debTimer=null;}
  if(waitMsg){waitMsg.remove();waitMsg=null;}
  const t=buf.join('\n'); buf=[]; if(!t)return;
  const typing=add('Ana esta digitando...','typing'); const t0=Date.now();
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
    // CND informativo: serve o PDF gerado por token efêmero (o adapter do Chatwoot baixa essa URL p/ anexar)
    if (req.method === 'GET' && req.url.startsWith('/cnd/')) {
      const token = req.url.slice(5).split('?')[0];
      const pdf = servirPdf(token);
      if (!pdf) return json(res, 404, { erro: 'documento não encontrado ou expirado' });
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="declaracao-quitacao.pdf"' });
      return res.end(pdf);
    }
    // Painel de aprovação (equipe) — protegido por passcode ?k=
    if (req.method === 'GET' && req.url.startsWith('/aprovacao/')) {
      const { renderPainel, passcodeOk } = await import('./src/write/painel.mjs');
      const { getDraftByToken } = await import('./src/write/drafts.mjs');
      const { getAction } = await import('./src/write/registry.mjs');
      const u = new URL(req.url, 'http://x'); const token = u.pathname.slice('/aprovacao/'.length).split('/')[0];
      const k = u.searchParams.get('k') || '';
      if (!passcodeOk(k, config.approvalPasscode)) { res.writeHead(401, { 'Content-Type': 'text/html' }); return res.end('<p>Passcode inválido. Use ?k=…</p>'); }
      const draft = await getDraftByToken(token);
      if (!draft) { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end('<p>Rascunho não encontrado ou expirado.</p>'); }
      const acao = getAction(draft.acao);
      if (acao?.render) draft.render = acao.render(draft.dados, draft.snapshot);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderPainel(draft, k));
    }
    if (req.method === 'POST' && req.url.startsWith('/aprovacao/')) {
      const { aprovarRascunho, rejeitarRascunho } = await import('./src/write/engine.mjs');
      const { passcodeOk } = await import('./src/write/painel.mjs');
      const u = new URL(req.url, 'http://x'); const parts = u.pathname.split('/'); const token = parts[2]; const op = parts[3];
      const body = new URLSearchParams((await readBody(req)) || '');
      if (!passcodeOk(body.get('k') || '', config.approvalPasscode)) return json(res, 401, { erro: 'passcode' });
      const aprovador = body.get('aprovador') || 'equipe';
      let out;
      if (op === 'aprovar') out = await aprovarRascunho(token, { aprovador });
      else if (op === 'rejeitar') out = await rejeitarRascunho(token, { aprovador, motivo: body.get('motivo') || '' });
      else if (op === 'corrigir') { const correcoes = {}; for (const [kk, vv] of body) if (!['k', 'aprovador'].includes(kk)) correcoes[kk] = vv; out = await aprovarRascunho(token, { aprovador, correcoes }); }
      else return json(res, 404, { erro: 'op' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<p>${out.ok ? 'Pronto: ' + (out.gravado ? 'gravado' + (out.dryRun ? ' (simulação)' : '') : out.rejeitado ? 'rejeitado' : 'ok') : 'Falhou: ' + (out.motivo || '')}</p>`);
    }
    // chat-send (mesmo serviço, protegido por código)
    if (req.method === 'POST' && req.url.startsWith('/chat-send')) {
      const data = JSON.parse((await readBody(req)) || '{}');
      if (config.chatPasscode && data.k !== config.chatPasscode) return json(res, 401, { reply: 'código inválido' });
      const chatKey = 'chat-' + (data.session || 'anon');
      const session = await getSession(chatKey);
      const r = await handleTurn(session, data.message || '', { chatId: null, fluxo: {}, transferred: null, cacheKey: chatKey });
      await saveSession(chatKey, session);
      return json(res, 200, { reply: r.reply, transferred: !!r.transferred, attachments: r.attachments || [], drafts: r.drafts || [] });
    }

    // Executor único de escrita (Onda 1 §4.4): o Portal (Estagiário) chama esta rota pra aprovar/rejeitar
    // um rascunho — quem grava no Superlógica é SEMPRE o agente-service. Rota INTERNA (rede `edge` do VPS,
    // sem exposição pública via Caddy — mesmo padrão do webhook do adapter Chatwoot). Reusa o guard do
    // WEBHOOK_SECRET quando setado (defesa extra além do isolamento de rede); não é obrigatório hoje.
    if (req.method === 'POST' && (req.url === '/write/aprovar' || req.url === '/write/rejeitar')) {
      if (config.webhookSecret) {
        const got = req.headers['x-webhook-secret'] || (req.headers['authorization'] || '').replace(/^Bearer /, '');
        if (got !== config.webhookSecret) return json(res, 401, { ok: false, motivo: 'unauthorized' });
      }
      let body = {};
      try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return json(res, 400, { ok: false, motivo: 'json_invalido' }); }
      const engine = await import('./src/write/engine.mjs').catch((e) => { console.warn('[srv] import engine.mjs falhou:', e.message); return {}; });
      const out = req.url === '/write/aprovar'
        ? await criarHandlerAprovar({ aprovarRascunhoPorId: engine.aprovarRascunhoPorId })(body)
        : await criarHandlerRejeitar({ rejeitarRascunhoPorId: engine.rejeitarRascunhoPorId, rejeitarRascunho: engine.rejeitarRascunho })(body);
      return json(res, out.status, out.json);
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
    const session = await getSession(sessionKey);
    const ctx = { chatId, fluxo, transferred: null, cacheKey: sessionKey };
    const { reply, transferred } = await handleTurn(session, text, ctx);
    await saveSession(sessionKey, session);
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
// Guard de entrypoint (mesmo padrão do adapter Chatwoot): importar este arquivo num teste NÃO sobe o
// server nem o worker do outbox — só `node server.mjs` direto (é o CMD do Dockerfile) faz o boot real.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  server.listen(config.port, async () => {
    console.log(`[ncs-agente] ouvindo :${config.port} | modelo ${config.agentModel} | dryRun=${config.dryRunWrites} | chat=${config.chatPasscode ? 'on' : 'off'}`);
    // Worker do outbox de notificações (Onda 1 §4.3): defensivo — se src/outbox.mjs ainda não existir
    // ou falhar ao iniciar, não derruba o boot do server (o /webhook e o /chat continuam no ar).
    try {
      const { startOutboxWorker } = await import('./src/outbox.mjs');
      if (typeof startOutboxWorker === 'function') { startOutboxWorker(); console.log('[ncs-agente] outbox worker iniciado'); }
      else console.warn('[ncs-agente] outbox.mjs presente mas sem startOutboxWorker() — worker não iniciado');
    } catch (e) {
      console.warn('[ncs-agente] outbox worker não iniciado (módulo ausente/erro):', e.message);
    }
  });
}
