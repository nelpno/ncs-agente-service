// test_deploy_chat_stack.mjs — determinístico, sem LLM, sem rede, sem disco de fora da árvore.
// Guarda do compose/env do ncs-chat (Estagiário), que é como a produção sobe.
//
// A regressão que isto trava JÁ ESTAVA ARMADA em 14/07: o ncs-chat tinha DOIS caminhos de
// deploy (.tmp/deploy_chat_ncs.mjs chat-only e a seção ncs-chat do .tmp/deploy_apps_ncs.mjs),
// cada um com seu compose e sua lista de env. O chat-only ganhou o login (10/07) e o Redis
// (14/07); o full-apps NUNCA recebeu nenhum dos dois. Rodar o full-apps teria, em silêncio:
//   - apagado SESSION_SECRET/SUPABASE_URL/SUPABASE_SERVICE_KEY → login quebrado pra equipe TODA;
//   - apagado USD_BRL/MODEL_PRICE_GPT_5_4 → painel de custo sem preço;
//   - voltado a imagem pra um digest velho (87f5f69b, era de 10/07).
// Agora os dois importam deploy/ncs-chat.stack.mjs e este teste é o contrato dele.
//
// Hermético de propósito: buildChatStack() é função PURA (não lê arquivo, não vai na rede) →
// roda no gate do CI, onde não existe .tmp/ nem segredo. Lição de 14/07: `env -i` prova ausência
// de VARIÁVEL, não de DISCO — teste que lê arquivo de fora da árvore passa aqui e quebra no CI.
import assert from "node:assert";
import { buildChatStack, CHAT_REQUIRED_ENV, CHAT_IMAGE } from "../deploy/ncs-chat.stack.mjs";

let ok = 0, total = 0;
const check = (c, m) => { total++; assert(c, m); ok++; };

// Segredos de mentira: o contrato é a FORMA do stack, não o valor.
const FAKE = {
  openaiKey: "sk-fake",
  geminiKey: "gem-fake",
  superlogicaAppToken: "app-fake",
  superlogicaAccessToken: "acc-fake",
  supabaseUrl: "https://dcirzddyoctxugfowvob.supabase.co",
  supabaseServiceKey: "svc-fake",
  sessionSecret: "x".repeat(64),
  chatPasscode: "pass-fake",
  // Onda 1: sem o MESMO segredo da Ana, o Portal chama /write/aprovar sem o header
  // `x-webhook-secret` → 401 → o botão "Aprovar" falha com erro genérico (bug ao vivo 15/07).
  webhookSecret: "wh-fake",
};

// ---------------------------------------------------------------- env
{
  const { env, missing } = buildChatStack(FAKE);
  const nomes = env.map((e) => e.name);

  check(missing.length === 0, `com todos os segredos, missing devia ser vazio: ${missing.join(",")}`);

  // Ancorado no que o container de PRODUÇÃO tem hoje (docker exec ncs-chat printenv, 14/07).
  // Tirar um nome daqui = tirar de prod: se for de propósito, mude os dois lados junto.
  const faltando = CHAT_REQUIRED_ENV.filter((n) => !nomes.includes(n));
  check(faltando.length === 0, `env do ncs-chat perdeu variável que prod tem: ${faltando.join(", ")}`);

  // As 3 que o full-apps apagaria: sem elas ninguém entra no Estagiário.
  for (const n of ["SESSION_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_KEY"]) {
    const e = env.find((x) => x.name === n);
    check(e && e.value, `${n} ausente/vazia → login do Estagiário quebra pra equipe toda`);
  }

  // Sem isto todo redeploy apagava a conversa em andamento da equipe (era in-memory até 14/07).
  const redis = env.find((e) => e.name === "REDIS_URL");
  check(redis?.value === "redis://redis:6379", `REDIS_URL errada/ausente: ${redis?.value}`);

  const dup = nomes.filter((n, i) => nomes.indexOf(n) !== i);
  check(dup.length === 0, `env duplicada (o último vence, em silêncio): ${dup.join(", ")}`);
}

// ------------------------------------------------- guard de segredo faltando
{
  // O deploy TEM que abortar em vez de subir container sem login.
  const { missing } = buildChatStack({ ...FAKE, sessionSecret: "", supabaseServiceKey: undefined });
  check(missing.includes("SESSION_SECRET"), "segredo vazio tem que entrar em missing (SESSION_SECRET)");
  check(missing.includes("SUPABASE_SERVICE_KEY"), "segredo ausente tem que entrar em missing (SUPABASE_SERVICE_KEY)");
}

// ------------------------------------------------- guard de SESSION_SECRET fraco
{
  // Segredo curto = cookie de sessão forjável. O guard existia só no chat-only; agora que os
  // dois caminhos passam por aqui, vale pros dois.
  const { fraco } = buildChatStack({ ...FAKE, sessionSecret: "curto" });
  check(fraco === true, "SESSION_SECRET curto tem que ser sinalizado (cookie forjável)");
  check(buildChatStack(FAKE).fraco === false, "SESSION_SECRET de 64 chars não pode ser marcado fraco");
}

// ---------------------------------------------------------------- compose
{
  const { compose } = buildChatStack(FAKE);

  // Imagem: `:latest` + pull_policy always. O full-apps pinava um digest de 10/07 → rodar ele
  // era um ROLLBACK silencioso do Estagiário. Prod roda :latest (docker inspect, 14/07).
  check(CHAT_IMAGE.endsWith(":latest"), `ncs-chat deve ser :latest (digest fixo vira rollback): ${CHAT_IMAGE}`);
  check(compose.includes(`image: ${CHAT_IMAGE}`), "compose não usa a imagem do módulo");
  check(/pull_policy:\s*always/.test(compose), "sem pull_policy:always o :latest não puxa o build novo");
  check(!/@sha256:/.test(compose), "digest fixo no compose do ncs-chat = rollback no próximo deploy");

  // Redis: serviço + volume + depends_on, senão a sessão da equipe morre no redeploy.
  check(/container_name:\s*ncs-chat-redis/.test(compose), "serviço redis ausente do compose");
  check(compose.includes("ncs_chat_redis_data"), "volume do redis ausente (sessão não sobrevive)");
  check(/depends_on:\s*\[redis\]/.test(compose), "ncs-chat sem depends_on:[redis]");
  check(/--appendonly/.test(compose), "redis sem appendonly → perde sessão no restart");

  // O redis não tem senha: não pode encostar na rede `edge`, que é externa/compartilhada.
  const blocoRedis = compose.slice(compose.indexOf("redis:\n    image: redis"));
  check(!/networks:\s*\[default,\s*edge\]/.test(blocoRedis), "redis SEM SENHA exposto na rede edge (compartilhada)");

  // O server do Estagiário não é o entrypoint padrão da imagem (que é a Ana).
  check(/command:\s*\["node",\s*"estagiario\/server\.mjs"\]/.test(compose), "command do ncs-chat errado");
  check(compose.includes("container_name: ncs-chat"), "container_name errado");

  // Toda env do módulo tem que aparecer como linha do compose (é o que chega no container).
  const { env } = buildChatStack(FAKE);
  const semLinha = env.filter((e) => !compose.includes(`      - ${e.name}=${e.value}`));
  check(semLinha.length === 0, `env que não virou linha do compose: ${semLinha.map((e) => e.name).join(", ")}`);
}

console.log(`test_deploy_chat_stack: ${ok}/${total} OK`);
