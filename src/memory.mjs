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
 */
export async function getSession(key) {
  const now = Date.now();

  if (useRedis()) {
    try {
      const raw = await redis.get(SESS_PREFIX + key);
      if (raw) {
        const parsed = JSON.parse(raw);
        // garante estrutura mínima
        if (!parsed.messages) parsed.messages = [];
        if (!parsed.ctx) parsed.ctx = {};
        parsed.touched = now;
        return parsed;
      }
    } catch (err) {
      console.warn('[memory] getSession Redis erro:', err.message, '— fallback Map');
    }
  }

  // fallback: Map
  let s = sessions.get(key);
  if (!s || now - s.touched > TTL_MS) {
    s = { messages: [], ctx: {}, touched: now };
    sessions.set(key, s);
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
