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
export const ANA_IMAGE = "ghcr.io/nelpno/ncs-agente-service@sha256:f73add853565a3e73b153eddcccde80dc130ac43fb88fd8a8c7bf50ccc53b1cd"; // 4cfadb9: F2 — fecha a linha da fila ao aprovar/rejeitar/expirar o rascunho (fila.marcarPorDraft + hook no engine); Decisão (b) mantida. F1 FILA_ANA_ENABLED=true (22/07)

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
  "SESSION_CONTINUITY_MIN",
  "DRY_RUN_WRITES",
  "AUDIT_LOG_PATH",
  "APPROVAL_PASSCODE",
  "APPROVAL_TTL_H",
  "ADAPTER_NOTIFY_URL",
  "SUPERLOGICA_WRITE_APP_TOKEN",
  "SUPERLOGICA_WRITE_ACCESS_TOKEN",
  "DOCIA_ATIVO",
  "DOCIA_GEMINI_KEY",
  // Onda 1 §5 (transporte do aviso por WhatsApp) — ver bloco no `env` abaixo.
  "ZAP_ENABLED",
  "ZUCK_BASE",
  "ZUCK_TOKEN",
  "ZAP_ALLOWLIST",
  // Onda 1 §4.4 — sem estes dois, sbEnabled()=false e os rascunhos caem no Redis; a aba
  // "Aprovações" do Portal lê `escrita_drafts` no Supabase e fica vazia. Medido em prod 14/07:
  // ncs-agente NÃO tinha SUPABASE_*, ncs-chat tinha → as duas telas em bancos diferentes.
  "SUPABASE_URL",
  "SUPABASE_SERVICE_KEY",
  // Espelho do Octadesk (saída fase 0, PASSIVO): o worker (server.mjs) só inicia com "true".
  // Depende de OCTADESK_* + SUPABASE_* (todas acima) — nenhuma dependência nova.
  "ESPELHO_ENABLED",
  // F1 (a Ana carimba o ticket na fila `solicitacoes`): default OFF = a Ana NÃO grava (byte-idêntico
  // ao de hoje). Ligar quando a fila estiver pronta pra receber trabalho. Depende de SUPABASE_* (acima).
  "FILA_ANA_ENABLED",
  // Onda C (titularidade). Ambas default VAZIO/OFF: sem elas a Ana é byte-idêntica ao de hoje
  // (a tool criar_rascunho_titularidade fica ESCONDIDA e toda escrita segue em DRY). Ficam aqui p/
  // ser possível LIGAR por env no teste controlado com o Fernando, SEM rebuild da imagem.
  // - TITULARIDADE_ENABLED=1 → a tool aparece p/ o LLM (exige o prompt de titularidade aplicado junto).
  // - WRITE_REAL_ACTIONS="titularidade" → só ESSA ação grava de verdade (o DRY_RUN global segue true).
  "TITULARIDADE_ENABLED",
  "WRITE_REAL_ACTIONS",
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
    // DocIA: default LIGADO (o ensaio de 15/07). `docia:false` desliga sem mexer no código.
    docia = true,
    dociaGeminiKey = "",
    // Transporte do aviso por WhatsApp (Onda 1 §5). Default DESLIGADO: sem `zap:true` o
    // comportamento é o de sempre (o aviso vira pendência humana). Ver bloco no `env`.
    zap = false,
    zuckToken = "",
    zuckBase = "https://zuck.dynamicagents.tech",
    zapAllowlist = "",
    // Espelho do Octadesk (saída fase 0). Default LIGADO: é PASSIVO (só lê /tickets do Octadesk e
    // escreve em `solicitacoes` no NOSSO Supabase — não responde ticket, não muda nada no Octadesk),
    // Fernando validou a tela (21/07). Desligar = `espelho:false` + redeploy (env, sem rebuild).
    espelho = true,
    // F1: a Ana carimba o ticket na fila `solicitacoes`. LIGADO (go-live 21/07): a Ana grava HANDOFF
    // e escrita-ERP com status próprio ('aberta'). Provado sem-humano em prod (NCS-A-2, LGPD ok).
    // Desligar = `filaAna:false` + redeploy (env, sem rebuild). Enxerto é try/catch: nunca derruba o atendimento.
    filaAna = true,
    // Onda C (titularidade): default DESLIGADO/vazio. `titularidade:true` mostra a tool ao LLM (só com o
    // prompt de titularidade aplicado). `writeRealActions:"titularidade"` sai do DRY SÓ p/ essa ação.
    // Os dois só no teste controlado com o Fernando (escrita real) — ver [[ncs-onda-c-titularidade-dry]].
    titularidade = false,
    writeRealActions = "",
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
    // Janela de continuidade da memória (a sessão segue o MORADOR, não o ticket): silêncio maior
    // que isto = assunto novo → sessão limpa. 120 = as ~2h que o Fernando pediu ("deixar a
    // conversa meia aberta"); o default do código é 60. Ajuste aqui = redeploy SEM rebuild.
    { name: "SESSION_CONTINUITY_MIN", value: "120" },
    // gate da escrita real no Superlógica (Onda 1 roda em DRY_RUN até liberar)
    { name: "DRY_RUN_WRITES", value: "true" },
    { name: "AUDIT_LOG_PATH", value: "/data/audit/escritas.jsonl" },
    { name: "APPROVAL_PASSCODE", value: approvalPasscode },
    { name: "APPROVAL_TTL_H", value: approvalTtlH },
    { name: "ADAPTER_NOTIFY_URL", value: adapterNotifyUrl },
    { name: "SUPERLOGICA_WRITE_APP_TOKEN", value: superlogicaWriteAppToken },
    { name: "SUPERLOGICA_WRITE_ACCESS_TOKEN", value: superlogicaWriteAccessToken },
    // ── DocIA ────────────────────────────────────────────────────────────────────────────────────
    // LIGADO para o ensaio do Nelson (15/07). É seguro AGORA por um motivo específico: o adapter do
    // Chatwoot NÃO foi deployado, então nenhum morador consegue entregar binário — só a tela /chat
    // (link com passcode) alcança o DocIA. O raio de alcance é a janela de teste, não a operação.
    // Desligar = trocar para "0" e redeployar (env, sem rebuild).
    { name: "DOCIA_ATIVO", value: docia ? "1" : "0" },
    // 🔴 ANTES de deployar o adapter (= abrir o DocIA para o WhatsApp), esta chave TEM que ser
    // própria. Vazia, o extrair.mjs cai na GEMINI_API_KEY — que é a MESMA do fallback cross-provider
    // do llm.mjs (a rede que segurou o incidente de 07/07, OpenAI sem crédito) e do multimodal do
    // adapter. Medido: ~20 análises seguidas estouraram a cota e deixaram o test_handleturn em 429.
    // Contrato = rajada (4 fotos) → sem chave própria, o DocIA derruba a rede dos DOIS bots, calado.
    { name: "DOCIA_GEMINI_KEY", value: dociaGeminiKey },
    // ── Aviso da portaria por WhatsApp (Onda 1 §5) ───────────────────────────────────────────────
    // Ligado SÓ para o ensaio filmado (15/07). O canal é o Zuck (não-oficial): a Cloud API oficial
    // não entrega em GRUPO e o não-oficial tem risco de ban — por isso o §5 segue em aberto e o
    // default do código é desligado (aí o aviso vira pendência visível, como antes).
    // ⚠️ A ALLOWLIST é o freio que faz o ensaio ser seguro: condomínio "Humana" roteia o síndico
    // para zap_individual = CELULAR PESSOAL dele. Só o JID do grupo de teste sai daqui; o resto
    // vira 'fora_da_allowlist' (pendência), nunca uma mensagem para alguém de verdade.
    // Em PRODUÇÃO: promover os 57 contatos para `condominio_contatos` (a tabela está VAZIA — o
    // JSON com os contatos NÃO é lido enquanto sbEnabled()) + capturar o JID de cada grupo, e só
    // então trocar a allowlist pelo conjunto real.
    { name: "ZAP_ENABLED", value: zap ? "true" : "false" },
    { name: "ZUCK_BASE", value: zuckBase },
    { name: "ZUCK_TOKEN", value: zuckToken },
    { name: "ZAP_ALLOWLIST", value: zapAllowlist },
    // Onda 1: a fila de aprovação (escrita_drafts/escrita_eventos) vive no Supabase do NCS,
    // o MESMO que o Portal (ncs-chat) lê. Sem elas, a Ana grava no Redis e a aba fica vazia.
    { name: "SUPABASE_URL", value: supabaseUrl },
    { name: "SUPABASE_SERVICE_KEY", value: supabaseServiceKey },
    // ── Espelho do Octadesk (saída fase 0) ───────────────────────────────────────────────────────
    // "true" = o worker do server.mjs sobe e a cada 5min lê /tickets do Octadesk → `solicitacoes`.
    // PASSIVO e reversível: com "false" o worker nem inicia (env, sem rebuild). Ver src/espelho.mjs.
    { name: "ESPELHO_ENABLED", value: espelho ? "true" : "false" },
    // ── F1: a Ana carimba o ticket na fila `solicitacoes` ─────────────────────────────────────────
    // "true" = os enxertos do runToolReal (transferir_humano / criar_rascunho_cadastro) inserem na fila.
    // Default "false" = no-op (prod byte-idêntico). Reversível por env, sem rebuild.
    { name: "FILA_ANA_ENABLED", value: filaAna ? "true" : "false" },
    // ── Onda C (titularidade) — DORMANTE por padrão ──────────────────────────────────────────────
    // "1" = a tool criar_rascunho_titularidade aparece p/ o LLM (agent.mjs filtra por esta env). Vazio
    // = escondida → a Ana segue mandando o formulário de titularidade (comportamento de hoje).
    // ⚠️ Só ligar JUNTO com o prompt de titularidade (senão o LLM cita uma tool que não vê).
    { name: "TITULARIDADE_ENABLED", value: titularidade ? "1" : "" },
    // CSV de ações que gravam DE VERDADE mesmo com DRY_RUN_WRITES=true (superlogica_write.acaoGravaReal).
    // Vazio = tudo DRY. É como o teste controlado grava SÓ a titularidade sem destravar as demais escritas.
    { name: "WRITE_REAL_ACTIONS", value: writeRealActions },
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
