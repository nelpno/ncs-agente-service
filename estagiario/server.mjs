// server.mjs — Chat NCS (assistente interno). Agora com LOGIN por usuário:
// TODAS as rotas exigem sessão (cookie httpOnly assinado), inclusive /doc/ (antes aberto).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { config } from "../src/config.mjs";
import { getSession, saveSession } from "../src/memory.mjs";
import { handleTurn } from "./src/agent.mjs";
import { SAIDA } from "./src/documentos.mjs";
import { descreverAnexo, montarMensagemComAnexo } from "./src/visao.mjs";
import { carregarSessao, verificarSenha, verificarSenhaDummy, assinarCookie, rateLogin, rateLoginIp, registrarFalha, resetRate, hashToken } from "./src/auth.mjs";
import { porEmail, porId, porTokenConvite, ativar, tocarUltimoAcesso, listar, criarComConvite, regenerarConvite, desativar, reativar, incrementarSessaoVersao, definirPodeAprovar } from "./src/usuarios.mjs";
import { montarInteracao, gravarInteracao } from "./src/registro.mjs"; // log por turno (auditoria + custo + tag)
import { classificarAsync } from "./src/classificar.mjs"; // tag do resíduo sem tool (LLM barato, fire-and-forget)
import { sbSelect } from "./src/db.mjs";
import { resumoPeriodo, porTag, porCondominio, porPessoa } from "./src/metrics.mjs"; // painel do admin
import { podeVerAprovacoes, listarPendentes as listarAprovacoesPendentes, aprovar as aprovarDraft, rejeitar as rejeitarDraft } from "./src/aprovacoes.mjs"; // aba Aprovações (spec Onda 1 §4.4)
import { podeVerPendencias, listarPendentes as listarNotificacoesPendentes } from "./src/pendencias.mjs"; // aba Pendências / outbox (spec Onda 1 §4.3)
import { podeVerSolicitacoes, listarSolicitacoes } from "./src/solicitacoes.mjs"; // aba Solicitações / espelho do Octadesk

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// cache-busting: versiona os links de /assets pelo hash do app.css → mudança de visual aparece na hora (sem limpar cache)
const ASSET_VER = crypto.createHash("md5").update(fs.readFileSync(path.join(__dirname, "public", "app.css"))).digest("hex").slice(0, 10);
const ver = (s) => s.replace(/(\/assets\/[\w.-]+)/g, `$1?v=${ASSET_VER}`);
const CHAT_HTML = ver(fs.readFileSync(path.join(__dirname, "public", "chat.html"), "utf8"));
const LOGIN_HTML = ver(fs.readFileSync(path.join(__dirname, "public", "login.html"), "utf8"));
const ADMIN_HTML = ver(fs.readFileSync(path.join(__dirname, "public", "admin.html"), "utf8"));
const APROVACOES_HTML = ver(fs.readFileSync(path.join(__dirname, "public", "aprovacoes.html"), "utf8"));
const PENDENCIAS_HTML = ver(fs.readFileSync(path.join(__dirname, "public", "pendencias.html"), "utf8"));
const SOLICITACOES_HTML = ver(fs.readFileSync(path.join(__dirname, "public", "solicitacoes.html"), "utf8"));
const PORT = parseInt(process.env.PORT || "8090", 10);
const COOKIE = "ncs_sess";
const COOKIE_MAXAGE_S = 30 * 24 * 3600; // 30 dias (sliding: renova a cada request autenticado)

// Fail-fast: sem SESSION_SECRET forte, o HMAC do cookie usaria chave vazia → qualquer um forja sessão. Recusa subir.
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error("[chat-ncs] FATAL: SESSION_SECRET ausente ou < 32 chars — recusando iniciar (cookies seriam forjáveis).");
  process.exit(1);
}

// Lê o corpo com TETO (DoS de memória pré-auth): pequeno no login/ativar, grande no /chat-send (anexo base64).
function readBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let d = "", len = 0, done = false;
    req.on("data", (c) => {
      if (done) return;
      len += c.length;
      if (len > maxBytes) { done = true; reject(new Error("body too large")); req.destroy(); return; }
      d += c;
    });
    req.on("end", () => { if (!done) { done = true; resolve(d); } });
    req.on("error", (e) => { if (!done) { done = true; reject(e); } });
  });
}
function json(res, code, obj) { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); }
function html(res, code, s) { res.writeHead(code, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" }); res.end(s); }
function redirect(res, to) { res.writeHead(302, { Location: to }); res.end(); }

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function setSessCookie(res, value, maxAgeS = COOKIE_MAXAGE_S) {
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeS}`);
}
function cookieDe(u) {
  return assinarCookie({ uid: u.id, exp: Date.now() + COOKIE_MAXAGE_S * 1000, sv: Number(u.sessao_versao) });
}
// CSRF: nos POSTs, se veio Origin/Referer, o host tem que bater. Sem eles (curl/e2e), SameSite=Lax cobre o browser.
function mesmaOrigem(req) {
  const src = req.headers.origin || req.headers.referer;
  if (!src) return true;
  try { return new URL(src).host === req.headers.host; } catch { return false; }
}
function proto(req) { return req.headers["x-forwarded-proto"] || "https"; }
// S2: token no FRAGMENTO (#t=) — o browser NÃO envia o fragmento ao servidor → fica fora do log do Caddy/Referer.
// O login.html lê de location.hash (fallback ?t=) e o POST /ativar segue com {token} no body.
function linkConvite(req, token) { return `${proto(req)}://${req.headers.host}/ativar#t=${token}`; }
// IP do cliente atrás do Caddy: 1º IP do X-Forwarded-For (o mais à esquerda = cliente original).
function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || "";
}
// Teto de memória (S4): no MÁXIMO ROW_CAP linhas por chamada do painel (evita OOM).
const ROW_CAP = 50000;
const RETENCAO_MAX_DIAS = 180; // janela máxima do painel (clampa `desde`)
// Lê as interações do período (pagina de 1000 em 1000 — PostgREST limita por página), até ROW_CAP.
async function fetchInteracoes(desde) {
  const all = [];
  for (let offset = 0; offset < ROW_CAP; offset += 1000) {
    const rows = await sbSelect("interacoes", `criado_em=gte.${encodeURIComponent(desde)}&select=*&order=criado_em.desc&limit=1000&offset=${offset}`);
    all.push(...rows);
    if (rows.length < 1000) break;
  }
  return all;
}
// Purga de retenção (S3/LGPD): apaga interações mais velhas que RETENCAO_DIAS (default 180).
// db.mjs não tem delete → fetch DELETE direto ao PostgREST reusando a env do db.mjs. Best-effort (try/catch).
async function purgarInteracoesAntigas() {
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!base || !key) return;
  const dias = Number(process.env.RETENCAO_DIAS || 180);
  const corte = new Date(Date.now() - dias * 86400 * 1000).toISOString();
  try {
    const r = await fetch(`${base}/rest/v1/interacoes?criado_em=lt.${encodeURIComponent(corte)}`, {
      method: "DELETE",
      headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "return=minimal" },
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) { console.error("[chat-ncs] purga LGPD:", r.status); return; }
    console.log(`[chat-ncs] purga LGPD: removidas interações anteriores a ${corte} (retenção ${dias}d)`);
  } catch (e) { console.error("[chat-ncs] purga LGPD:", e.message); }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = req.url.split("?")[0];

    // ---------- rotas PÚBLICAS ----------
    if (req.method === "GET" && url === "/health") return json(res, 200, { ok: true, service: "chat-ncs", model: config.agentModel });

    // assets visuais (css/fonte/logo) — públicos, path-safe (basename + extensão whitelist)
    if (req.method === "GET" && url.startsWith("/assets/")) {
      const name = path.basename(decodeURIComponent(url.slice(8).split("?")[0]));
      const TYPES = { ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".js": "application/javascript", ".jpg": "image/jpeg", ".ico": "image/x-icon" };
      const ct = TYPES[path.extname(name).toLowerCase()];
      const fp = path.join(__dirname, "public", name);
      if (!ct || !fs.existsSync(fp)) return json(res, 404, { erro: "não encontrado" });
      res.writeHead(200, { "Content-Type": ct, "Cache-Control": "public, max-age=31536000, immutable" });
      return res.end(fs.readFileSync(fp));
    }
    if (req.method === "GET" && (url === "/login" || url === "/ativar")) return html(res, 200, LOGIN_HTML);

    if (req.method === "POST" && url === "/login") {
      if (!mesmaOrigem(req)) return json(res, 403, { erro: "origem inválida" });
      // Rate-limit por IP ANTES de qualquer scrypt (S1) — trava o flood que varia o e-mail. 429 uniforme.
      if (!rateLoginIp(clientIp(req))) return json(res, 429, { erro: "Muitas tentativas. Aguarde um momento e tente de novo." });
      const d = JSON.parse((await readBody(req, 64_000)) || "{}");
      const email = (d.email || "").trim().toLowerCase();
      const senha = d.senha || "";
      if (!rateLogin(email)) return json(res, 429, { erro: "Muitas tentativas. Aguarde um momento e tente de novo." });
      const u = await porEmail(email);
      const okUser = !!(u && u.ativo && u.senha_hash);
      // scrypt (agora ASYNC) roda nos DOIS caminhos (dummy quando não existe) → resposta E tempo uniformes (anti-enumeração)
      const senhaOk = okUser ? await verificarSenha(senha, u.senha_hash, u.senha_salt) : await verificarSenhaDummy(senha);
      if (!okUser || !senhaOk) {
        registrarFalha(email);
        return json(res, 401, { erro: "E-mail ou senha inválidos." });
      }
      resetRate(email);
      await tocarUltimoAcesso(u.id);
      setSessCookie(res, cookieDe(u));
      return json(res, 200, { ok: true, nome: u.nome, papel: u.papel });
    }

    if (req.method === "POST" && url === "/ativar") {
      if (!mesmaOrigem(req)) return json(res, 403, { erro: "origem inválida" });
      const d = JSON.parse((await readBody(req, 64_000)) || "{}");
      const token = (d.token || "").trim();
      const senha = d.senha || "";
      if (senha.length < 8) return json(res, 400, { erro: "A senha precisa ter ao menos 8 caracteres." });
      const u = await porTokenConvite(hashToken(token));
      if (!u || !u.convite_token_hash || !u.convite_expira || new Date(u.convite_expira).getTime() < Date.now()) {
        return json(res, 400, { erro: "Convite inválido ou expirado. Peça um novo link ao administrador." });
      }
      await ativar(u.id, senha);          // grava senha, zera o convite, incrementa sessao_versao
      const fresh = await porId(u.id);    // pega a sessao_versao já incrementada p/ o cookie
      await tocarUltimoAcesso(u.id);
      setSessCookie(res, cookieDe(fresh));
      return json(res, 200, { ok: true, nome: u.nome });
    }

    // ---------- GUARDA (tudo abaixo exige sessão) ----------
    const sess = await carregarSessao(parseCookies(req)[COOKIE], porId);
    const isPage = req.method === "GET" && (url === "/" || url === "/chat" || url === "/admin" || url === "/aprovacoes" || url === "/pendencias" || url === "/solicitacoes");
    if (!sess) {
      if (isPage) return redirect(res, "/login");
      return json(res, 401, { erro: "não autenticado" }); // API (/chat-send, /doc/, /api/*) → 401
    }
    // slide: renova a validade do cookie a cada request autenticado
    setSessCookie(res, assinarCookie({ uid: sess.uid, exp: Date.now() + COOKIE_MAXAGE_S * 1000, sv: sess.sv }));

    if (req.method === "POST" && url === "/logout") {
      // S7: revoga de verdade — incrementa sessao_versao ANTES de limpar o cookie → derruba cookies roubados
      // (efeito colateral aceito: desloga a pessoa em todos os dispositivos). Best-effort: nunca trava o logout.
      try { await incrementarSessaoVersao(sess.uid); } catch (e) { console.error("[chat-ncs] logout sv:", e.message); }
      res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
      return json(res, 200, { ok: true });
    }

    // "quem sou eu" — as telas usam pra decidir quais itens de nav mostrar; nunca vaza email/id
    if (req.method === "GET" && url === "/api/me") return json(res, 200, { nome: sess.nome, papel: sess.papel, podeAprovar: sess.podeAprovar });

    // download da minuta/relatório gerado — AGORA protegido por sessão (era aberto)
    if (req.method === "GET" && url.startsWith("/doc/")) {
      const name = path.basename(decodeURIComponent(url.slice(5)));
      const fp = path.join(SAIDA, name);
      const isDoc = name.endsWith(".doc");
      if ((!name.endsWith(".pdf") && !isDoc) || !fs.existsSync(fp)) return json(res, 404, { erro: "não encontrado" });
      const ct = isDoc ? "application/msword" : "application/pdf";
      const disp = isDoc ? "attachment" : "inline";
      res.writeHead(200, { "Content-Type": ct, "Content-Disposition": `${disp}; filename="${name}"` });
      return res.end(fs.readFileSync(fp));
    }

    if (req.method === "GET" && (url === "/" || url === "/chat")) return html(res, 200, CHAT_HTML);

    // ---------- Aprovações (spec Onda 1 §4.4) — Portal é UI; quem GRAVA é o executor único (agente-service) ----------
    // A página em si é servida pra qualquer sessão válida (mesmo padrão do /admin: o acesso de
    // verdade é decidido pela API abaixo, que devolve 403 e a tela mostra "sem permissão").
    if (req.method === "GET" && url === "/aprovacoes") return html(res, 200, APROVACOES_HTML);

    if (req.method === "GET" && url === "/api/aprovacoes") {
      if (!podeVerAprovacoes(sess)) return json(res, 403, { erro: "acesso restrito" });
      try {
        const itens = await listarAprovacoesPendentes();
        return json(res, 200, { itens });
      } catch (e) {
        console.error("[chat-ncs] aprovacoes list:", e.message);
        return json(res, 502, { erro: "não foi possível carregar as aprovações agora" });
      }
    }

    const mDecisao = url.match(/^\/api\/aprovacoes\/([^/]{1,64})\/(aprovar|rejeitar)$/);
    if (req.method === "POST" && mDecisao) {
      if (!podeVerAprovacoes(sess)) return json(res, 403, { erro: "acesso restrito" });
      if (!mesmaOrigem(req)) return json(res, 403, { erro: "origem inválida" });
      const [, draftId, acao] = mDecisao;
      const d = JSON.parse((await readBody(req, 4_000)) || "{}");
      // identidade de quem decidiu — SEMPRE da sessão (nunca do body, senão dava pra forjar o aprovador)
      const aprovador = { user_id: sess.uid, nome: sess.nome, papel: sess.papel };
      try {
        const executar = acao === "aprovar" ? aprovarDraft : rejeitarDraft;
        const out = await executar({ draftId: decodeURIComponent(draftId), aprovador, motivo: d.motivo || null });
        return json(res, 200, { ok: true, resultado: out });
      } catch (e) {
        console.error(`[chat-ncs] aprovacoes ${acao}:`, e.message);
        return json(res, 502, { erro: "não foi possível concluir agora. Tente de novo." });
      }
    }

    // ---------- Pendências (outbox de notificações, spec Onda 1 §4.3) — fila SÓ LEITURA ----------
    if (req.method === "GET" && url === "/pendencias") return html(res, 200, PENDENCIAS_HTML);

    if (req.method === "GET" && url === "/api/pendencias") {
      if (!podeVerPendencias(sess)) return json(res, 403, { erro: "acesso restrito" });
      try {
        const itens = await listarNotificacoesPendentes();
        return json(res, 200, { itens });
      } catch (e) {
        console.error("[chat-ncs] pendencias list:", e.message);
        return json(res, 502, { erro: "não foi possível carregar as pendências agora" });
      }
    }

    // ---------- Solicitações (espelho passivo do Octadesk, tabela `solicitacoes`) — fila SÓ LEITURA ----------
    if (req.method === "GET" && url === "/solicitacoes") return html(res, 200, SOLICITACOES_HTML);

    if (req.method === "GET" && url === "/api/solicitacoes") {
      if (!podeVerSolicitacoes(sess)) return json(res, 403, { erro: "acesso restrito" });
      try {
        const qs = new URLSearchParams(req.url.split("?")[1] || "");
        const itens = await listarSolicitacoes({ tipo: qs.get("tipo") || undefined, status: qs.get("status") || undefined });
        return json(res, 200, { itens });
      } catch (e) {
        console.error("[chat-ncs] solicitacoes list:", e.message);
        return json(res, 502, { erro: "não foi possível carregar as solicitações agora" });
      }
    }

    if (req.method === "POST" && url === "/chat-send") {
      if (!mesmaOrigem(req)) return json(res, 403, { erro: "origem inválida" });
      const data = JSON.parse((await readBody(req, 32_000_000)) || "{}"); // teto alto: anexo (base64 de foto/PDF)
      // chave por USUÁRIO + conversa (o uid vem do cookie, nunca do front)
      const estagKey = `estag-${sess.uid}-${data.session || "default"}`;
      const t0 = Date.now();
      let turno, erro = false;
      try {
        const session = await getSession(estagKey);
        let msg = data.message || "";
        if (data.anexo && typeof data.anexo === "string" && data.anexo.startsWith("data:")) {
          const vis = await descreverAnexo(data.anexo);
          msg = montarMensagemComAnexo(msg, vis);
        }
        turno = await handleTurn(session, msg, { cacheKey: estagKey });
        await saveSession(estagKey, session);
      } catch (e) {
        erro = true;
        console.error("[chat-ncs] turno:", e.message);
        turno = { reply: "Tive um problema aqui. Pode tentar de novo?", doc: null, usage: {}, toolsUsed: [] };
      }
      // registra o turno SEMPRE (incl. erro=true/latência); nunca deixa o log derrubar a resposta
      try {
        const userText = data.message || (data.anexo ? "[anexo]" : "");
        const row = montarInteracao({ sess, sessionId: estagKey, userText, turno, tMs: Date.now() - t0, erro });
        const id = await gravarInteracao(row);
        if (id && !erro && row.tag === null) classificarAsync(id, userText).catch(() => {}); // resíduo sem tool → tag async
      } catch (e) { console.error("[chat-ncs] registro:", e.message); }
      return json(res, 200, { reply: turno.reply, doc: turno.doc || null });
    }

    // ---------- ADMIN (owner + admin) ----------
    if (url === "/admin" || url.startsWith("/api/admin")) {
      if (!["owner", "admin"].includes(sess.papel)) return json(res, 403, { erro: "acesso restrito" });
      const isOwner = sess.papel === "owner"; // só o dono vê o custo em R$

      if (req.method === "GET" && url === "/admin") return html(res, 200, ADMIN_HTML);

      if (req.method === "GET" && url === "/api/admin/metricas") {
        const qs = new URLSearchParams(req.url.split("?")[1] || "");
        const now = new Date();
        // Teto de janela (S4): default = 1º do mês; clampa `desde` a no máx RETENCAO_MAX_DIAS atrás
        // (impede o painel de varrer anos de histórico e estourar memória junto com o ROW_CAP).
        const piso = Date.now() - RETENCAO_MAX_DIAS * 86400 * 1000;
        let desdeMs = Date.parse(qs.get("desde"));
        if (Number.isNaN(desdeMs)) desdeMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
        if (desdeMs < piso) desdeMs = piso;
        const desde = new Date(desdeMs).toISOString();
        const rows = await fetchInteracoes(desde);
        const usersRaw = await listar();
        const nomes = {}, papeis = {};
        usersRaw.forEach((u) => { nomes[u.id] = u.nome; papeis[u.id] = u.papel; });
        const resumo = resumoPeriodo(rows, process.env);
        if (!isOwner) delete resumo.custoBRL; // admin cliente não vê o total em R$
        const equipe = usersRaw.map((u) => ({ id: u.id, nome: u.nome, email: u.email, papel: u.papel, ativo: u.ativo, ultimo_acesso: u.ultimo_acesso, convitePendente: !!u.convite_token_hash, podeAprovar: !!u.pode_aprovar }));
        return json(res, 200, { desde, isOwner, me: { nome: sess.nome, papel: sess.papel, podeAprovar: sess.podeAprovar }, resumo, tags: porTag(rows), condominios: porCondominio(rows), pessoas: porPessoa(rows, process.env, { comCusto: isOwner, nomes, papeis }), equipe });
      }

      if (req.method === "POST" && url === "/api/admin/usuarios") {
        if (!mesmaOrigem(req)) return json(res, 403, { erro: "origem inválida" });
        const d = JSON.parse((await readBody(req, 64_000)) || "{}");
        const nome = (d.nome || "").trim();
        const email = (d.email || "").trim().toLowerCase();
        const papel = d.papel === "admin" ? "admin" : "funcionario"; // owner só nasce por seed
        if (!nome || !email) return json(res, 400, { erro: "Nome e e-mail são obrigatórios." });
        if (await porEmail(email)) return json(res, 409, { erro: "Já existe alguém com esse e-mail." });
        const { usuario, token } = await criarComConvite({ nome, email, papel });
        return json(res, 200, { ok: true, id: usuario.id, link: linkConvite(req, token) });
      }

      const m = url.match(/^\/api\/admin\/usuarios\/([0-9a-fA-F-]{36})\/(reenviar|desativar|ativar)$/);
      if (req.method === "POST" && m) {
        if (!mesmaOrigem(req)) return json(res, 403, { erro: "origem inválida" });
        const [, id, acao] = m;
        const target = await porId(id);
        if (!target) return json(res, 404, { erro: "usuário não encontrado" });
        if (target.papel === "owner" && !isOwner) return json(res, 403, { erro: "só o dono gerencia o dono" });
        if (acao === "desativar") {
          // S5: UUID é case-insensitive — compara normalizado p/ não driblar o guard com hex maiúsculo
          if (id.toLowerCase() === sess.uid.toLowerCase()) return json(res, 400, { erro: "Você não pode desativar a si mesmo." });
          await desativar(id); return json(res, 200, { ok: true });
        }
        if (acao === "ativar") { await reativar(id); return json(res, 200, { ok: true }); }
        if (acao === "reenviar") { return json(res, 200, { ok: true, link: linkConvite(req, await regenerarConvite(id)) }); }
      }

      // liga/desliga a aba Aprovações da pessoa (spec Onda 1 §4.4) — mesmo guard owner/admin acima
      const mPA = url.match(/^\/api\/admin\/usuarios\/([0-9a-fA-F-]{36})\/pode_aprovar$/);
      if (req.method === "POST" && mPA) {
        if (!mesmaOrigem(req)) return json(res, 403, { erro: "origem inválida" });
        const [, id] = mPA;
        const target = await porId(id);
        if (!target) return json(res, 404, { erro: "usuário não encontrado" });
        if (target.papel === "owner" && !isOwner) return json(res, 403, { erro: "só o dono gerencia o dono" });
        const d = JSON.parse((await readBody(req, 4_000)) || "{}");
        await definirPodeAprovar(id, !!d.valor);
        return json(res, 200, { ok: true, podeAprovar: !!d.valor });
      }

      return json(res, 404, { erro: "not found" });
    }

    return json(res, 404, { erro: "not found" });
  } catch (e) {
    if (e && e.message === "body too large") { try { return json(res, 413, { erro: "conteúdo grande demais" }); } catch { return; } }
    console.error("[chat-ncs] erro:", e.message);
    try { return json(res, 200, { reply: "Tive um problema aqui. Pode tentar de novo?", erro: true }); } catch { return; }
  }
});
server.listen(PORT, () => console.log(`[chat-ncs] ouvindo :${PORT} | modelo ${config.agentModel} | auth=on`));

// Retenção LGPD (S3): purga de interações antigas — 1× ~30s após o boot e depois a cada 24h.
// .unref() p/ os timers não segurarem o processo. Best-effort (a função engole o próprio erro).
setTimeout(purgarInteracoesAntigas, 30_000).unref();
setInterval(purgarInteracoesAntigas, 24 * 3600 * 1000).unref();
