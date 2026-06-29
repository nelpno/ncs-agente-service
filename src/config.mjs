// config.mjs — lê env (Portainer injeta como variáveis). Sem segredo no código.
const env = process.env;
function req(name) {
  if (!env[name]) console.warn(`[config] AVISO: variável ${name} não definida`);
  return env[name] || '';
}
export const config = {
  port: parseInt(env.PORT || '8080', 10),
  // LLM
  openrouterKey: req('OPENROUTER_API_KEY'),
  openrouterBase: env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  agentModel: env.AGENT_MODEL || 'google/gemini-2.5-flash',
  // Octadesk
  octaBase: env.OCTADESK_BASE_URL || 'https://o222276-30e.api002.octadesk.services',
  octaKey: req('OCTADESK_API_KEY'),
  octaSubdomain: env.OCTADESK_SUBDOMAIN || 'o222276-30e',
  octaAgentEmail: env.OCTADESK_AGENT_EMAIL || '',
  // Superlógica
  slBase: env.SUPERLOGICA_BASE_URL || 'https://api.superlogica.net/v2/condor',
  slApp: req('SUPERLOGICA_APP_TOKEN'),
  slAccess: req('SUPERLOGICA_ACCESS_TOKEN'),
  // segurança
  webhookSecret: env.WEBHOOK_SECRET || '',
  chatPasscode: env.CHAT_PASSCODE || '',
  dryRunWrites: (env.DRY_RUN_WRITES || 'true') !== 'false',
  logPII: env.LOG_PII === 'true',
  // URL pública do próprio serviço (p/ servir PDFs gerados — ex.: CND — que viram anexo baixável)
  publicBase: env.PUBLIC_BASE_URL || 'https://ncs.dynamicagents.tech',
  // Autentique (assinatura digital do CND OFICIAL) — env-gated; sandbox-first (não gasta crédito até virar a chave)
  autentiqueToken: env.AUTENTIQUE_TOKEN || '',
  autentiqueSandbox: (env.AUTENTIQUE_SANDBOX || 'true') !== 'false',
  autentiqueEndpoint: env.AUTENTIQUE_ENDPOINT || 'https://api.autentique.com.br/v2/graphql',
  // Redis (memória persistente de sessão)
  redisUrl: env.REDIS_URL || '',
  sessionTtlS: parseInt(env.SESSION_TTL_S || '172800', 10),
  // --- Motor de escritas ---
  auditLogPath: env.AUDIT_LOG_PATH || './.data/audit/escritas.jsonl',
  approvalPasscode: env.APPROVAL_PASSCODE || env.CHAT_PASSCODE || '',
  approvalTtlH: parseInt(env.APPROVAL_TTL_H || '72', 10),
  slWriteApp: env.SUPERLOGICA_WRITE_APP_TOKEN || '',
  slWriteAccess: env.SUPERLOGICA_WRITE_ACCESS_TOKEN || '',
  adapterNotifyUrl: env.ADAPTER_NOTIFY_URL || '',
};
