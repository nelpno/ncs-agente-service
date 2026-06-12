// memory.mjs — memória de conversa por sessão (chatId/roomkey). Em RAM com TTL.
// ⚠️ Em produção com múltiplas instâncias/fila, trocar por Redis (queue-safe) — ver plano §2.
const sessions = new Map();
const TTL_MS = 1000 * 60 * 60; // 1h

export function getSession(key) {
  const now = Date.now();
  let s = sessions.get(key);
  if (!s || now - s.touched > TTL_MS) { s = { messages: [], ctx: {}, touched: now }; sessions.set(key, s); }
  s.touched = now;
  return s;
}
export function resetSession(key) { sessions.delete(key); }

// limpeza periódica
setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions) if (now - s.touched > TTL_MS) sessions.delete(k);
}, TTL_MS).unref?.();
