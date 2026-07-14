// auth.mjs — autenticação custom leve do Estagiário (spec §4.2).
// Senha: scrypt + salt por usuário. Sessão: cookie httpOnly assinado (HMAC-SHA256).
// Convite: token de uso único (guarda só o hash). Rate-limit de login por e-mail (em memória).
// Papel/validade vêm SEMPRE do banco a cada request (cookie carrega só uid/exp/sv).
import crypto from "node:crypto";
import { promisify } from "node:util";

// scrypt ASSÍNCRONO (S1): a versão *Sync trava o event-loop enquanto deriva a chave →
// um flood de /login (variando e-mail) congela o processo inteiro. A async cede o loop.
const scrypt = promisify(crypto.scrypt);

// ---------- senha (scrypt async) ----------
export async function hashSenha(senha, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = (await scrypt(senha, salt, 64)).toString("hex");
  return { hash, salt };
}
export async function verificarSenha(senha, hash, salt) {
  if (!hash || !salt) return false;
  const h = await scrypt(senha, salt, 64);
  const hb = Buffer.from(hash, "hex");
  return h.length === hb.length && crypto.timingSafeEqual(h, hb); // comprimento + bytes
}
// Anti-enumeração por timing: gasta o MESMO scrypt quando o usuário não existe/sem senha,
// pra o /login não distinguir e-mail cadastrado de inexistente pelo tempo de resposta.
const _DUMMY = await hashSenha("x", "0".repeat(32)); // top-level await (ESM): 1 scrypt no import
export async function verificarSenhaDummy(senha) {
  try { await verificarSenha(senha, _DUMMY.hash, _DUMMY.salt); } catch { /* nunca lança */ }
  return false;
}

// ---------- cookie HMAC ----------
const SECRET = () => process.env.SESSION_SECRET || "";
function hmac(s) {
  return crypto.createHmac("sha256", SECRET()).update(s).digest("base64url");
}
export function assinarCookie(payload) {
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${p}.${hmac(p)}`;
}
export function verificarCookie(cookie) {
  if (!cookie || typeof cookie !== "string" || !cookie.includes(".")) return null;
  const [p, sig] = cookie.split(".");
  if (!p || !sig) return null;
  const good = hmac(p);
  const sigBuf = Buffer.from(sig), goodBuf = Buffer.from(good); // comparar em BYTES (evita RangeError com char multibyte)
  if (sigBuf.length !== goodBuf.length || !crypto.timingSafeEqual(sigBuf, goodBuf)) return null;
  try {
    const o = JSON.parse(Buffer.from(p, "base64url").toString());
    return o.exp && o.exp > Date.now() ? o : null;
  } catch {
    return null;
  }
}

// ---------- convite (uso único; guarda só o hash) ----------
export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
export function novoConvite(dias = 7) {
  const token = crypto.randomBytes(32).toString("hex");
  return {
    token, // cru — só retornado (nunca persistido)
    tokenHash: hashToken(token),
    expira: new Date(Date.now() + dias * 86400 * 1000).toISOString(),
  };
}

// ---------- rate-limit de login por e-mail (backoff progressivo, em memória) ----------
// S6: sem hard-lock de 15 min. As primeiras falhas (RL_FREE) não penalizam; depois a espera
// cresce exponencialmente por falha (teto RL_MAX_MS) → dificulta brute-force SEM virar um
// DoS de lockout de conta conhecida. resetRate() zera no sucesso. Reinicia no redeploy (ok).
// Erro de login é uniforme (anti-enumeração).
const RL_FREE = 2;                 // primeiras falhas sem espera
const RL_BASE_MS = 2000;           // base do backoff (2ª falha penalizada = 2s)
const RL_MAX_MS = 15 * 60 * 1000;  // teto da espera por-falha
const TENTATIVAS = new Map(); // email -> { fails, until }
export function rateLogin(email) {
  const rec = TENTATIVAS.get((email || "").toLowerCase());
  return !(rec && rec.until > Date.now()); // bloqueado enquanto until no futuro
}
export function registrarFalha(email) {
  const e = (email || "").toLowerCase();
  const rec = TENTATIVAS.get(e) || { fails: 0, until: 0 };
  rec.fails++;
  if (rec.fails > RL_FREE) {
    const espera = Math.min(RL_BASE_MS * 2 ** (rec.fails - RL_FREE - 1), RL_MAX_MS);
    rec.until = Date.now() + espera;
  }
  TENTATIVAS.set(e, rec);
}
export function resetRate(email) {
  TENTATIVAS.delete((email || "").toLowerCase());
}

// ---------- rate-limit de login por IP (janela deslizante curta) ----------
// S1: trava o flood que VARIA o e-mail pra escapar do limite por-conta. Checado ANTES do scrypt.
// O IP vem do X-Forwarded-For (Caddy à frente) — ver clientIp() no server.mjs.
const IP_MAX = Number(process.env.LOGIN_IP_MAX || 30); // tentativas por minuto por IP
const IP_JANELA_MS = 60 * 1000;
const IP_HITS = new Map(); // ip -> number[] (timestamps na janela)
export function rateLoginIp(ip) {
  if (!ip) return true; // sem IP identificável não bloqueia (o limite por-email ainda vale)
  const now = Date.now();
  const arr = (IP_HITS.get(ip) || []).filter((t) => now - t < IP_JANELA_MS);
  arr.push(now);
  IP_HITS.set(ip, arr);
  if (IP_HITS.size > 5000) { // limpeza oportunista p/ o Map não crescer sem limite
    for (const [k, v] of IP_HITS) if (!v.some((t) => now - t < IP_JANELA_MS)) IP_HITS.delete(k);
  }
  return arr.length <= IP_MAX;
}

// ---------- guarda de sessão ----------
// Verifica o cookie, busca o usuário FRESCO no banco e confere ativo + sessao_versao.
// `buscarPorId(uid) => usuario|null` (async). Retorna { uid, papel, nome, podeAprovar } ou null.
// `podeAprovar` (spec §4.4) vem do banco A CADA request (igual `papel`) — revogar o toggle no
// admin.html já tranca a aba Aprovações no PRÓXIMO request, sem precisar bump de sessao_versao
// (esse campo só derruba o cookie inteiro; não é necessário aqui porque não há credencial em jogo).
export async function carregarSessao(cookie, buscarPorId) {
  const o = verificarCookie(cookie);
  if (!o || !o.uid) return null;
  const u = await buscarPorId(o.uid);
  if (!u || !u.ativo) return null;
  if (Number(u.sessao_versao) !== Number(o.sv)) return null; // reset/reativação derruba cookies antigos
  return { uid: u.id, papel: u.papel, nome: u.nome, sv: Number(u.sessao_versao), podeAprovar: !!u.pode_aprovar };
}
