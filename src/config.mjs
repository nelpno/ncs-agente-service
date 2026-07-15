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
  // Prefixo do bot p/ o prompt_cache_key da OpenAI (a chave final é "<prefixo>:<sessão>"). Vazio = não envia.
  promptCacheKey: env.PROMPT_CACHE_KEY || '',
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
  publicBase: env.PUBLIC_BASE_URL || 'https://ana.gruponcs.net',
  // Autentique (assinatura digital do CND OFICIAL) — env-gated; sandbox-first (não gasta crédito até virar a chave)
  autentiqueToken: env.AUTENTIQUE_TOKEN || '',
  autentiqueSandbox: (env.AUTENTIQUE_SANDBOX || 'true') !== 'false',
  autentiqueEndpoint: env.AUTENTIQUE_ENDPOINT || 'https://api.autentique.com.br/v2/graphql',
  // Redis (memória persistente de sessão)
  redisUrl: env.REDIS_URL || '',
  sessionTtlS: parseInt(env.SESSION_TTL_S || '172800', 10),
  // Janela de continuidade: a memória segue o MORADOR (não o ticket), mas silêncio maior que
  // isto = assunto novo → sessão limpa (não arrasta contexto velho nem infla tokens).
  // 0 = desliga a janela (só o TTL de 48h corta). Ver test_sessao_janela.mjs.
  sessionContinuityMin: parseInt(env.SESSION_CONTINUITY_MIN || '60', 10),
  // Supabase dedicado do NCS (mesmo do Estagiário) — motor de escritas/outbox/contatos (Onda 1).
  // Vazio => módulos caem no fallback Redis/in-memory (DRY_RUN local, testes offline).
  supabaseUrl: env.SUPABASE_URL || '',
  supabaseServiceKey: env.SUPABASE_SERVICE_KEY || '',
  sbTimeoutMs: parseInt(env.SB_TIMEOUT_MS || '15000', 10),
  // --- Motor de escritas ---
  auditLogPath: env.AUDIT_LOG_PATH || './.data/audit/escritas.jsonl',
  approvalPasscode: env.APPROVAL_PASSCODE || env.CHAT_PASSCODE || '',
  approvalTtlH: parseInt(env.APPROVAL_TTL_H || '72', 10),
  slWriteApp: env.SUPERLOGICA_WRITE_APP_TOKEN || '',
  slWriteAccess: env.SUPERLOGICA_WRITE_ACCESS_TOKEN || '',
  adapterNotifyUrl: env.ADAPTER_NOTIFY_URL || '',
};
