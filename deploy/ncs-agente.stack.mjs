// ncs-agente.stack.mjs — FONTE ÚNICA do compose+env da Ana. Irmão do ncs-chat.stack.mjs.
//
// Por que existe: a Ana também tinha DUAS cópias de config (.tmp/deploy_ana_only_ncs.mjs e a
// seção Ana do .tmp/deploy_apps_ncs.mjs). O cabeçalho do ana_only dizia "reusa toda a config do
// deploy_apps_ncs.mjs" — não reusava, COPIAVA; a frase era aspiração, e virou mentira quando as
// duas andaram. As env seguiam iguais (27 = 27), mas o DIGEST divergiu: ana_only pinava d284163f
// (o que prod roda) e o full-apps ainda pinava 897e64d1 (aa11143, 10/07) → rodar o full-apps
// fazia ROLLBACK da Ana, que atende morador 24/7, perdendo taxa/Onda 1/57 contatos.
//
// Função PURA (não lê arquivo, não vai na rede): quem lê segredo é o script de deploy, que passa
// aqui dentro. É isso que deixa test/test_deploy_ana_stack.mjs rodar no gate do CI, onde não há
// .tmp/ nem segredo.

// ⚠️ A Ana é pinada por DIGEST de propósito (o oposto do ncs-chat, que usa :latest): assim um
// push qualquer não a move, e um deploy do Estagiário não a arrasta junto. Trocar a versão da Ana
// = editar ESTA constante (agora versionada: o digest ganha histórico e revisão, que nunca teve
// enquanto morava em dois .tmp/ soltos).
//
// Como atualizar: git push → CI publica :latest → no VPS
//   docker image inspect ghcr.io/nelpno/ncs-agente-service:latest --format '{{index .RepoDigests 0}}'
// → cole aqui → confirme que a imagem é a sua (o label `revision` vem VAZIO):
//   docker run --rm --entrypoint sh <img> -c 'grep -c "<sua string>" spec/system-prompt.md'
export const ANA_IMAGE = "ghcr.io/nelpno/ncs-agente-service@sha256:d284163fa4515460ff2548b11afb8f541b796bff60f68bceeb1c6f0975f4dc83"; // 09587c1: taxa+moove+Onda1(DRY_RUN)+57 contatos

// Ancorado no container de PRODUÇÃO (docker exec ncs-agente printenv, 14/07), menos as que a
// imagem injeta (PATH/HOME/NODE_*) e CHROME_PATH, que vem do `ENV` do Dockerfile — não do compose.
export const ANA_REQUIRED_ENV = [
  "PORT",
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
  "AGENT_MODEL",
  "PROMPT_CACHE_KEY",
  "GEMINI_API_KEY",
  "FALLBACK_MODEL",
  "OCTADESK_BASE_URL",
  "OCTADESK_API_KEY",
  "OCTADESK_SUBDOMAIN",
  "OCTADESK_AGENT_EMAIL",
  "SUPERLOGICA_APP_TOKEN",
  "SUPERLOGICA_ACCESS_TOKEN",
  "PUBLIC_BASE_URL",
  "AUTENTIQUE_TOKEN",
  "AUTENTIQUE_SANDBOX",
  "WEBHOOK_SECRET",
  "CHAT_PASSCODE",
  "REDIS_URL",
  "SESSION_TTL_S",
  "DRY_RUN_WRITES",
  "AUDIT_LOG_PATH",
  "APPROVAL_PASSCODE",
  "APPROVAL_TTL_H",
  "ADAPTER_NOTIFY_URL",
  "SUPERLOGICA_WRITE_APP_TOKEN",
  "SUPERLOGICA_WRITE_ACCESS_TOKEN",
  // Onda 1 §4.4 — sem estes dois, sbEnabled()=false e os rascunhos caem no Redis; a aba
  // "Aprovações" do Portal lê `escrita_drafts` no Supabase e fica vazia. Medido em prod 14/07:
  // ncs-agente NÃO tinha SUPABASE_*, ncs-chat tinha → as duas telas em bancos diferentes.
  "SUPABASE_URL",
  "SUPABASE_SERVICE_KEY",
];

// Exceção à regra "vazio é legítimo na Ana": aqui vazio == o serviço sobe e SÓ a fila morre,
// em silêncio. Vale mais abortar o deploy do que descobrir pela aba vazia semanas depois.
const NAO_PODE_VAZIA = new Set(["SUPABASE_URL", "SUPABASE_SERVICE_KEY"]);

/**
 * Monta o stack da Ana. Segredos entram por parâmetro (o script de deploy os lê do .env / .tmp).
 * @returns {{image, env: {name,value}[], compose: string, missing: string[]}}
 *   missing = nomes com valor `null`/ausente → o deploy deve ABORTAR.
 *   ⚠️ Vazio ("") NÃO é missing aqui (≠ ncs-chat): OCTADESK_AGENT_EMAIL, AUTENTIQUE_*, APPROVAL_*,
 *   ADAPTER_NOTIFY_URL e WRITE_* são legitimamente vazios enquanto o recurso não está ligado.
 */
export function buildAnaStack(secrets = {}) {
  const {
    openaiKey,
    geminiKey,
    webhookSecret,
    chatPasscode,
    octadeskBaseUrl,
    octadeskApiKey,
    superlogicaAppToken,
    superlogicaAccessToken,
    autentiqueToken = "",
    autentiqueSandbox = "true",
    approvalPasscode = "",
    approvalTtlH = "",
    adapterNotifyUrl = "",
    superlogicaWriteAppToken = "",
    superlogicaWriteAccessToken = "",
    supabaseUrl,
    supabaseServiceKey,
  } = secrets;

  const env = [
    { name: "PORT", value: "8080" },
    { name: "OPENROUTER_API_KEY", value: openaiKey },
    { name: "OPENROUTER_BASE_URL", value: "https://api.openai.com/v1" },
    { name: "AGENT_MODEL", value: "gpt-5.4" },
    // roteamento de cache de prefixo (OpenAI) por-conversa
    { name: "PROMPT_CACHE_KEY", value: "ncs-ana" },
    { name: "GEMINI_API_KEY", value: geminiKey },
    // reserva CROSS-PROVIDER: com a OpenAI sem crédito (07/07) a Ana e o Estagiário caíram
    // juntos. Reserva no mesmo provedor não serve — morre junto.
    { name: "FALLBACK_MODEL", value: "gemini-2.5-flash" },
    { name: "OCTADESK_BASE_URL", value: octadeskBaseUrl || "https://o222276-30e.api002.octadesk.services" },
    { name: "OCTADESK_API_KEY", value: octadeskApiKey },
    { name: "OCTADESK_SUBDOMAIN", value: "o222276-30e" },
    { name: "OCTADESK_AGENT_EMAIL", value: "" },
    { name: "SUPERLOGICA_APP_TOKEN", value: superlogicaAppToken },
    { name: "SUPERLOGICA_ACCESS_TOKEN", value: superlogicaAccessToken },
    { name: "PUBLIC_BASE_URL", value: "https://ana.gruponcs.net" },
    { name: "AUTENTIQUE_TOKEN", value: autentiqueToken },
    { name: "AUTENTIQUE_SANDBOX", value: autentiqueSandbox },
    { name: "WEBHOOK_SECRET", value: webhookSecret },
    { name: "CHAT_PASSCODE", value: chatPasscode },
    { name: "REDIS_URL", value: "redis://redis:6379" },
    { name: "SESSION_TTL_S", value: "172800" },
    // gate da escrita real no Superlógica (Onda 1 roda em DRY_RUN até liberar)
    { name: "DRY_RUN_WRITES", value: "true" },
    { name: "AUDIT_LOG_PATH", value: "/data/audit/escritas.jsonl" },
    { name: "APPROVAL_PASSCODE", value: approvalPasscode },
    { name: "APPROVAL_TTL_H", value: approvalTtlH },
    { name: "ADAPTER_NOTIFY_URL", value: adapterNotifyUrl },
    { name: "SUPERLOGICA_WRITE_APP_TOKEN", value: superlogicaWriteAppToken },
    { name: "SUPERLOGICA_WRITE_ACCESS_TOKEN", value: superlogicaWriteAccessToken },
    // Onda 1: a fila de aprovação (escrita_drafts/escrita_eventos) vive no Supabase do NCS,
    // o MESMO que o Portal (ncs-chat) lê. Sem elas, a Ana grava no Redis e a aba fica vazia.
    { name: "SUPABASE_URL", value: supabaseUrl },
    { name: "SUPABASE_SERVICE_KEY", value: supabaseServiceKey },
  ];

  // Só null/ausente aborta — vazio é estado legítimo aqui (ver JSDoc), EXCETO nas de NAO_PODE_VAZIA,
  // onde vazio é indistinguível do bug que elas existem para evitar (fallback silencioso p/ Redis).
  const missing = env
    .filter((e) => e.value == null || (NAO_PODE_VAZIA.has(e.name) && e.value === ""))
    .map((e) => e.name);

  const envLines = env.map((e) => `      - ${e.name}=${e.value ?? ""}`).join("\n");
  const compose = `services:
  ncs-agente:
    image: ${ANA_IMAGE}
    container_name: ncs-agente
    restart: unless-stopped
    environment:
${envLines}
    volumes:
      - ncs_agente_audit_data:/data/audit
    depends_on: [redis]
    networks: [default, edge]
    logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }
  redis:
    image: redis:7-alpine
    container_name: ncs-agente-redis
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes", "--maxmemory", "256mb", "--maxmemory-policy", "volatile-ttl"]
    volumes:
      - ncs_agente_redis_data:/data
    networks: [default]
    logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }
volumes:
  ncs_agente_redis_data:
  ncs_agente_audit_data:
networks:
  default:
  edge:
    external: true
`;

  return { image: ANA_IMAGE, env, compose, missing };
}
