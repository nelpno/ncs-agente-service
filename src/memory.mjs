// memory.mjs — memória de conversa por sessão (chatId/roomkey).
// Redis persistente (REDIS_URL) com fallback automático para in-memory.
// Interface: async getSession / async saveSession / async resetSession.
import { config } from './config.mjs';

// ── fallback in-memory ───────────────────────────────────────────────────────
const sessions = new Map();
const TTL_MS = (config.sessionTtlS || 172800) * 1000;

// limpeza periódica do Map (só relevante no fallback)
setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions) if (now - s.touched > TTL_MS) sessions.delete(k);
}, Math.min(TTL_MS, 3_600_000)).unref?.();

// ── Redis client (opcional) ──────────────────────────────────────────────────
let redis = null;
let redisDown = false;
let redisErrorLogged = false;

if (config.redisUrl) {
  try {
    // import dinâmico: se ioredis não estiver instalado, cai pro fallback
    const { default: Redis } = await import('ioredis');
    redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: false,
    });

    redis.on('error', (err) => {
      if (!redisErrorLogged) {
        console.warn('[memory] Redis indisponível — usando fallback in-memory:', err.message);
        redisErrorLogged = true;
      }
      redisDown = true;
    });

    redis.on('ready', () => {
      if (redisDown) console.log('[memory] Redis reconectado — retomando persistência.');
      redisDown = false;
      redisErrorLogged = false;
    });

    console.log('[memory] Redis configurado:', config.redisUrl.replace(/:\/\/.*@/, '://**@'));
  } catch (err) {
    console.warn('[memory] ioredis não disponível — usando fallback in-memory:', err.message);
    redis = null;
  }
} else {
  console.log('[memory] REDIS_URL ausente — operando 100% in-memory.');
}

// ── helpers ──────────────────────────────────────────────────────────────────
function useRedis() { return redis !== null && !redisDown; }
const SESS_PREFIX = 'sess:';

// ── API pública (async) ──────────────────────────────────────────────────────

/**
 * Retorna (ou cria) a sessão para a key dada.
 * NUNCA lança — em caso de erro no Redis cai pro Map silenciosamente.
 *
 * opts.maxIdleMs — JANELA DE CONTINUIDADE (opcional): sessão parada há mais que isso volta
 * VAZIA (assunto novo começa limpo, sem arrastar histórico velho nem inflar tokens). Omitido
 * = comportamento de sempre (só o TTL de 48h corta). Ver test_sessao_janela.mjs.
 */
export async function getSession(key, opts = {}) {
  const now = Date.now();
  const maxIdleMs = opts.maxIdleMs || 0;
  const expirou = (touched) => maxIdleMs > 0 && touched && now - touched > maxIdleMs;

  if (useRedis()) {
    try {
      const raw = await redis.get(SESS_PREFIX + key);
      if (raw) {
        const parsed = JSON.parse(raw);
        // garante estrutura mínima
        if (!parsed.messages) parsed.messages = [];
        if (!parsed.ctx) parsed.ctx = {};
        // fora da janela → sessão limpa. Não apaga o Redis: o saveSession do fim do turno
        // sobrescreve. (Se o turno morrer antes, a velha segue expirada — mesmo resultado.)
        if (expirou(parsed.touched)) return { messages: [], ctx: {}, touched: now };
        parsed.touched = now;
        return parsed;
      }
    } catch (err) {
      console.warn('[memory] getSession Redis erro:', err.message, '— fallback Map');
    }
  }

  // fallback: Map
  let s = sessions.get(key);
  if (!s || now - s.touched > TTL_MS || expirou(s.touched)) {
    s = { messages: [], ctx: {}, touched: now };
    sessions.set(key, s); // substitui a velha: o Map guarda por referência, senão ela ressuscita
  }
  s.touched = now;
  return s;
}

/**
 * Persiste a sessão após handleTurn.
 * Serializa APENAS {messages, ctx, touched}.
 * NUNCA lança.
 */
export async function saveSession(key, session) {
  session.touched = Date.now();
  const payload = JSON.stringify({
    messages: session.messages,
    ctx: session.ctx,
    touched: session.touched,
  });

  if (useRedis()) {
    try {
      await redis.set(SESS_PREFIX + key, payload, 'EX', config.sessionTtlS);
      return;
    } catch (err) {
      console.warn('[memory] saveSession Redis erro:', err.message, '— fallback Map');
    }
  }

  // fallback: grava no Map
  sessions.set(key, session);
}

/**
 * Apaga a sessão (logout / "nova conversa").
 * NUNCA lança.
 */
export async function resetSession(key) {
  if (useRedis()) {
    try {
      await redis.del(SESS_PREFIX + key);
    } catch (err) {
      console.warn('[memory] resetSession Redis erro:', err.message);
    }
  }
  sessions.delete(key);
}

// --- KV genérico (reusa o mesmo client/fallback das sessões) ---
const kvFallback = new Map(); // key -> { value, expires }
export async function kvSet(key, value, ttlS) {
  if (useRedis()) {
    try { await redis.set(key, JSON.stringify(value), 'EX', ttlS); return; }
    catch (err) { console.warn('[memory] kvSet Redis erro:', err.message, '— fallback Map'); }
  }
  kvFallback.set(key, { value, expires: Date.now() + ttlS * 1000 });
}
export async function kvGet(key) {
  if (useRedis()) {
    try { const raw = await redis.get(key); return raw ? JSON.parse(raw) : null; }
    catch (err) { console.warn('[memory] kvGet Redis erro:', err.message, '— fallback Map'); }
  }
  const v = kvFallback.get(key);
  if (!v || v.expires < Date.now()) { kvFallback.delete(key); return null; }
  return v.value;
}
export async function kvDel(key) {
  if (useRedis()) {
    try { await redis.del(key); return; }
    catch (err) { console.warn('[memory] kvDel Redis erro:', err.message); }
  }
  kvFallback.delete(key);
}
