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
  dryRunWrites: (env.DRY_RUN_WRITES || 'true') !== 'false',
  logPII: env.LOG_PII === 'true',
};
