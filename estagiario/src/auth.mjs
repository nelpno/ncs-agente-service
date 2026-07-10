// auth.mjs — autenticação custom leve do Estagiário (spec §4.2).
// Senha: scrypt + salt por usuário. Sessão: cookie httpOnly assinado (HMAC-SHA256).
// Convite: token de uso único (guarda só o hash). Rate-limit de login por e-mail (em memória).
// Papel/validade vêm SEMPRE do banco a cada request (cookie carrega só uid/exp/sv).
import crypto from "node:crypto";

// ---------- senha (scrypt) ----------
export function hashSenha(senha, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(senha, salt, 64).toString("hex");
  return { hash, salt };
}
export function verificarSenha(senha, hash, salt) {
  if (!hash || !salt) return false;
  const h = crypto.scryptSync(senha, salt, 64);
  const hb = Buffer.from(hash, "hex");
  return h.length === hb.length && crypto.timingSafeEqual(h, hb);
}
// Anti-enumeração por timing: gasta o MESMO scrypt quando o usuário não existe/sem senha,
// pra o /login não distinguir e-mail cadastrado de inexistente pelo tempo de resposta.
const _DUMMY = hashSenha("x", "0".repeat(32));
export function verificarSenhaDummy(senha) {
  try { verificarSenha(senha, _DUMMY.hash, _DUMMY.salt); } catch { /* nunca lança */ }
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

// ---------- rate-limit de login (por e-mail, em memória) ----------
// 5 falhas → backoff de 15 min. Reinicia no redeploy (aceitável). Erro de login é uniforme (anti-enumeração).
const RL_MAX = 5;
const RL_JANELA_MS = 15 * 60 * 1000;
const TENTATIVAS = new Map(); // email -> { fails, until }
export function rateLogin(email) {
  const rec = TENTATIVAS.get((email || "").toLowerCase());
  return !(rec && rec.until > Date.now()); // bloqueado enquanto until no futuro
}
export function registrarFalha(email) {
  const e = (email || "").toLowerCase();
  const rec = TENTATIVAS.get(e) || { fails: 0, until: 0 };
  rec.fails++;
  if (rec.fails >= RL_MAX) rec.until = Date.now() + RL_JANELA_MS;
  TENTATIVAS.set(e, rec);
}
export function resetRate(email) {
  TENTATIVAS.delete((email || "").toLowerCase());
}

// ---------- guarda de sessão ----------
// Verifica o cookie, busca o usuário FRESCO no banco e confere ativo + sessao_versao.
// `buscarPorId(uid) => usuario|null` (async). Retorna { uid, papel, nome } ou null.
export async function carregarSessao(cookie, buscarPorId) {
  const o = verificarCookie(cookie);
  if (!o || !o.uid) return null;
  const u = await buscarPorId(o.uid);
  if (!u || !u.ativo) return null;
  if (Number(u.sessao_versao) !== Number(o.sv)) return null; // reset/reativação derruba cookies antigos
  return { uid: u.id, papel: u.papel, nome: u.nome, sv: Number(u.sessao_versao) };
}
