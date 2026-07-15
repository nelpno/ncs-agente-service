// ncs-chat.stack.mjs — FONTE ÚNICA do compose+env do ncs-chat (Estagiário).
//
// Por que existe: o ncs-chat tinha DOIS caminhos de deploy com compose e env próprios
// (.tmp/deploy_chat_ncs.mjs chat-only e a seção ncs-chat do .tmp/deploy_apps_ncs.mjs).
// Mexer em um deixava o outro apagar a mudança no próximo deploy, EM SILÊNCIO. Foi assim que
// o REDIS_URL nunca chegou no container, e em 14/07 o full-apps ainda apagaria o login inteiro
// (SESSION_SECRET/SUPABASE_*) e voltaria a imagem pra um digest de 10/07. Os dois scripts
// importam este módulo: existe UM lugar para mudar, e test/test_deploy_chat_stack.mjs o trava.
//
// Função PURA de propósito (não lê arquivo, não vai na rede): quem lê segredo é o script de
// deploy, que passa aqui dentro. É isso que deixa o teste rodar no gate do CI, onde não há
// .tmp/ nem segredo — `env -i` prova ausência de variável, não de disco.
//
// Este módulo NÃO é usado em runtime pelo container; mora no repo pelo histórico/revisão e
// para o gate do CI poder guardá-lo.

// Prod roda :latest (docker inspect ncs-chat, 14/07) e o CI publica :latest a cada push.
// Digest fixo aqui = rollback silencioso do Estagiário no próximo full-deploy (já aconteceu).
// A Ana continua pinada por digest de propósito — ela é o que não pode mover sem querer.
export const CHAT_IMAGE = "ghcr.io/nelpno/ncs-agente-service:latest";

// Ancorado no container de PRODUÇÃO (docker exec ncs-chat printenv, 14/07), menos as que o
// Node/imagem injetam (PATH, HOME, NODE_VERSION...). Tirar um nome daqui = tirar de prod.
export const CHAT_REQUIRED_ENV = [
  "PORT",
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
  "AGENT_MODEL",
  "PROMPT_CACHE_KEY",
  "CHAT_PASSCODE",
  "SUPERLOGICA_APP_TOKEN",
  "SUPERLOGICA_ACCESS_TOKEN",
  "SUPERLOGICA_BASE_URL",
  "GEMINI_API_KEY",
  "CHROME_PATH",
  "PUBLIC_BASE_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_KEY",
  "SESSION_SECRET",
  "USD_BRL",
  "MODEL_PRICE_GPT_5_4",
  "REDIS_URL",
  // Onda 1: o Portal chama o executor unico (agente-service) p/ aprovar/rejeitar. A rota
  // /write/aprovar exige `x-webhook-secret` quando o WEBHOOK_SECRET esta setado la (e esta) →
  // sem o MESMO segredo aqui, o botao "Aprovar" da 401 e falha calado (bug visto ao vivo 15/07).
  "WEBHOOK_SECRET",
  "NCS_AGENTE_URL",
];

const SESSION_SECRET_MIN = 32;

/**
 * Monta o stack do ncs-chat. Segredos entram por parâmetro (o script de deploy os lê do
 * .env / .tmp e passa aqui).
 * @returns {{image, env: {name,value}[], compose: string, missing: string[], fraco: boolean}}
 *   missing = nomes sem valor (o deploy deve ABORTAR: container sem login/token não serve)
 *   fraco   = SESSION_SECRET curto demais (cookie de sessão forjável)
 */
export function buildChatStack(secrets = {}) {
  const {
    openaiKey,
    geminiKey,
    superlogicaAppToken,
    superlogicaAccessToken,
    supabaseUrl,
    supabaseServiceKey,
    sessionSecret,
    chatPasscode,
    webhookSecret,
  } = secrets;

  const env = [
    { name: "PORT", value: "8090" },
    { name: "OPENROUTER_API_KEY", value: openaiKey },
    { name: "OPENROUTER_BASE_URL", value: "https://api.openai.com/v1" },
    { name: "AGENT_MODEL", value: "gpt-5.4" },
    // roteamento de cache de prefixo (OpenAI) por-conversa
    { name: "PROMPT_CACHE_KEY", value: "ncs-estagiario" },
    // ignorado pelo server novo (login por cookie); mantido inofensivo
    { name: "CHAT_PASSCODE", value: chatPasscode },
    { name: "SUPERLOGICA_APP_TOKEN", value: superlogicaAppToken },
    { name: "SUPERLOGICA_ACCESS_TOKEN", value: superlogicaAccessToken },
    { name: "SUPERLOGICA_BASE_URL", value: "https://api.superlogica.net/v2/condor" },
    { name: "GEMINI_API_KEY", value: geminiKey },
    { name: "CHROME_PATH", value: "/usr/bin/chromium-browser" },
    // links de PDF/doc servidos pelo próprio Estagiário
    { name: "PUBLIC_BASE_URL", value: "https://estagiario.gruponcs.net" },
    // --- LOGIN + ANALYTICS: sem estas três ninguém entra no Estagiário ---
    { name: "SUPABASE_URL", value: supabaseUrl },
    { name: "SUPABASE_SERVICE_KEY", value: supabaseServiceKey },
    { name: "SESSION_SECRET", value: sessionSecret },
    { name: "USD_BRL", value: "5.40" },
    { name: "MODEL_PRICE_GPT_5_4", value: "2.50/0.25/15" },
    // sessão da equipe sobrevive ao redeploy (TTL 48h). Sem isto o server cai em in-memory.
    { name: "REDIS_URL", value: "redis://redis:6379" },
    // executor unico da Onda 1 (rede interna `edge` do VPS) + segredo compartilhado com a Ana
    { name: "WEBHOOK_SECRET", value: webhookSecret },
    { name: "NCS_AGENTE_URL", value: "http://ncs-agente:8080" },
  ];

  const missing = env.filter((e) => e.value == null || e.value === "").map((e) => e.name);
  const fraco = !sessionSecret || sessionSecret.length < SESSION_SECRET_MIN;

  const envLines = env.map((e) => `      - ${e.name}=${e.value ?? ""}`).join("\n");
  const compose = `services:
  ncs-chat:
    image: ${CHAT_IMAGE}
    container_name: ncs-chat
    restart: unless-stopped
    pull_policy: always
    command: ["node", "estagiario/server.mjs"]
    environment:
${envLines}
    depends_on: [redis]
    networks: [default, edge]
    logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }

  # Memoria de conversa do Estagiario (espelha o padrao da Ana). Sem isto o server cai em
  # in-memory e TODO redeploy apaga a conversa em andamento da equipe. So na rede "default"
  # da stack: a "edge" e externa/compartilhada e este redis nao tem senha.
  redis:
    image: redis:7-alpine
    container_name: ncs-chat-redis
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes", "--maxmemory", "256mb", "--maxmemory-policy", "volatile-ttl"]
    volumes:
      - ncs_chat_redis_data:/data
    networks: [default]
volumes:
  ncs_chat_redis_data:
networks:
  default:
  edge:
    external: true
`;

  return { image: CHAT_IMAGE, env, compose, missing, fraco };
}
