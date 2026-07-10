// server.mjs — Chat NCS (assistente interno). Agora com LOGIN por usuário:
// TODAS as rotas exigem sessão (cookie httpOnly assinado), inclusive /doc/ (antes aberto).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.mjs";
import { getSession, saveSession } from "../src/memory.mjs";
import { handleTurn } from "./src/agent.mjs";
import { SAIDA } from "./src/documentos.mjs";
import { descreverAnexo, montarMensagemComAnexo } from "./src/visao.mjs";
import { carregarSessao, verificarSenha, verificarSenhaDummy, assinarCookie, rateLogin, registrarFalha, resetRate, hashToken } from "./src/auth.mjs";
import { porEmail, porId, porTokenConvite, ativar, tocarUltimoAcesso } from "./src/usuarios.mjs";
import { montarInteracao, gravarInteracao } from "./src/registro.mjs"; // log por turno (auditoria + custo + tag)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHAT_HTML = fs.readFileSync(path.join(__dirname, "public", "chat.html"), "utf8");
const LOGIN_HTML = fs.readFileSync(path.join(__dirname, "public", "login.html"), "utf8");
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
function html(res, code, s) { res.writeHead(code, { "Content-Type": "text/html; charset=utf-8" }); res.end(s); }
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

const server = http.createServer(async (req, res) => {
  try {
    const url = req.url.split("?")[0];

    // ---------- rotas PÚBLICAS ----------
    if (req.method === "GET" && url === "/health") return json(res, 200, { ok: true, service: "chat-ncs", model: config.agentModel });
    if (req.method === "GET" && (url === "/login" || url === "/ativar")) return html(res, 200, LOGIN_HTML);

    if (req.method === "POST" && url === "/login") {
      if (!mesmaOrigem(req)) return json(res, 403, { erro: "origem inválida" });
      const d = JSON.parse((await readBody(req, 64_000)) || "{}");
      const email = (d.email || "").trim().toLowerCase();
      const senha = d.senha || "";
      if (!rateLogin(email)) return json(res, 429, { erro: "Muitas tentativas. Tente de novo em 15 minutos." });
      const u = await porEmail(email);
      const okUser = !!(u && u.ativo && u.senha_hash);
      // scrypt roda nos DOIS caminhos (dummy quando não existe) → resposta E tempo uniformes (anti-enumeração)
      const senhaOk = okUser ? verificarSenha(senha, u.senha_hash, u.senha_salt) : verificarSenhaDummy(senha);
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
    const isPage = req.method === "GET" && (url === "/" || url === "/chat" || url === "/admin");
    if (!sess) {
      if (isPage) return redirect(res, "/login");
      return json(res, 401, { erro: "não autenticado" }); // API (/chat-send, /doc/, /api/*) → 401
    }
    // slide: renova a validade do cookie a cada request autenticado
    setSessCookie(res, assinarCookie({ uid: sess.uid, exp: Date.now() + COOKIE_MAXAGE_S * 1000, sv: sess.sv }));

    if (req.method === "POST" && url === "/logout") {
      res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
      return json(res, 200, { ok: true });
    }

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
        turno = await handleTurn(session, msg, {});
        await saveSession(estagKey, session);
      } catch (e) {
        erro = true;
        console.error("[chat-ncs] turno:", e.message);
        turno = { reply: "Tive um problema aqui. Pode tentar de novo?", doc: null, usage: {}, toolsUsed: [] };
      }
      // registra o turno SEMPRE (incl. erro=true/latência); nunca deixa o log derrubar a resposta
      try {
        const userText = data.message || (data.anexo ? "[anexo]" : "");
        await gravarInteracao(montarInteracao({ sess, sessionId: estagKey, userText, turno, tMs: Date.now() - t0, erro }));
      } catch (e) { console.error("[chat-ncs] registro:", e.message); }
      return json(res, 200, { reply: turno.reply, doc: turno.doc || null });
    }

    // ---------- ADMIN (só papel=admin) ----------
    if (url === "/admin" || url.startsWith("/api/admin")) {
      if (sess.papel !== "admin") return json(res, 403, { erro: "acesso restrito" });
      if (req.method === "GET" && url === "/admin")
        return html(res, 200, "<!doctype html><meta charset=utf-8><title>Admin NCS</title><p style='font-family:sans-serif;padding:40px'>Painel em construção (Chunk 5).</p>");
      return json(res, 404, { erro: "not found" }); // endpoints reais no Chunk 5
    }

    return json(res, 404, { erro: "not found" });
  } catch (e) {
    if (e && e.message === "body too large") { try { return json(res, 413, { erro: "conteúdo grande demais" }); } catch { return; } }
    console.error("[chat-ncs] erro:", e.message);
    try { return json(res, 200, { reply: "Tive um problema aqui. Pode tentar de novo?", erro: true }); } catch { return; }
  }
});
server.listen(PORT, () => console.log(`[chat-ncs] ouvindo :${PORT} | modelo ${config.agentModel} | auth=on`));
