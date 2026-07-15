// test_deploy_ana_stack.mjs — determinístico, sem LLM, sem rede, sem disco de fora da árvore.
// Irmão do test_deploy_chat_stack: guarda o compose/env da ANA (ncs-agente), que atende morador 24/7.
//
// Mesma armadilha das duas cópias, e aqui ela também JÁ estava armada (medido 14/07): as env
// batiam (27 = 27), mas o DIGEST da imagem divergiu — .tmp/deploy_ana_only_ncs.mjs pinava
// d284163f (= o que prod roda) e a seção Ana do .tmp/deploy_apps_ncs.mjs ainda pinava 897e64d1
// (aa11143, de 10/07). Rodar o full-apps faria ROLLBACK da Ana, perdendo taxa/Onda 1/57 contatos.
// O cabeçalho do ana_only dizia "reusa toda a config do deploy_apps_ncs.mjs" — não reusava, COPIAVA.
//
// Hermético: buildAnaStack() é função PURA (não lê arquivo, não vai na rede) → roda no gate do CI.
import assert from "node:assert";
import { buildAnaStack, ANA_REQUIRED_ENV, ANA_IMAGE } from "../deploy/ncs-agente.stack.mjs";

let ok = 0, total = 0;
const check = (c, m) => { total++; assert(c, m); ok++; };

const FAKE = {
  openaiKey: "sk-fake",
  geminiKey: "gem-fake",
  webhookSecret: "wh-fake",
  chatPasscode: "pass-fake",
  octadeskBaseUrl: "https://o222276-30e.api002.octadesk.services",
  octadeskApiKey: "octa-fake",
  superlogicaAppToken: "app-fake",
  superlogicaAccessToken: "acc-fake",
  // Opcionais: vazio é LEGÍTIMO na Ana (≠ ncs-chat). Não podem entrar em `missing`.
  autentiqueToken: "",
  autentiqueSandbox: "",
  approvalPasscode: "",
  approvalTtlH: "",
  adapterNotifyUrl: "",
  superlogicaWriteAppToken: "",
  superlogicaWriteAccessToken: "",
};

// ---------------------------------------------------------------- env
{
  const { env, missing } = buildAnaStack(FAKE);
  const nomes = env.map((e) => e.name);

  // Ancorado no container de PRODUÇÃO (docker exec ncs-agente printenv, 14/07), menos as que a
  // imagem injeta: PATH/HOME/NODE_* e CHROME_PATH (esta vem do ENV do Dockerfile, não do compose).
  const faltando = ANA_REQUIRED_ENV.filter((n) => !nomes.includes(n));
  check(faltando.length === 0, `env da Ana perdeu variável que prod tem: ${faltando.join(", ")}`);
  check(nomes.length === ANA_REQUIRED_ENV.length, `env a mais/menos: script=${nomes.length} × esperado=${ANA_REQUIRED_ENV.length}`);

  // ⚠️ Diferença REAL para o ncs-chat: aqui vazio é válido (OCTADESK_AGENT_EMAIL, AUTENTIQUE_*,
  // APPROVAL_*, ADAPTER_NOTIFY_URL, WRITE_*). Só `null`/ausente é que aborta o deploy.
  check(missing.length === 0, `vazio NÃO é 'faltando' na Ana (só null): ${missing.join(",")}`);

  const dup = nomes.filter((n, i) => nomes.indexOf(n) !== i);
  check(dup.length === 0, `env duplicada (o último vence, em silêncio): ${dup.join(", ")}`);

  // A escrita real no Superlógica é travada por env: se sumir, a Ana passa a gravar de verdade.
  const dry = env.find((e) => e.name === "DRY_RUN_WRITES");
  check(dry?.value === "true", `DRY_RUN_WRITES devia ser "true" (gate da escrita real): ${dry?.value}`);

  // Sessão do morador (48h) e reserva cross-provider: os dois já custaram incidente.
  check(env.find((e) => e.name === "REDIS_URL")?.value === "redis://redis:6379", "REDIS_URL errada/ausente");
  check(env.find((e) => e.name === "FALLBACK_MODEL")?.value, "FALLBACK_MODEL ausente → OpenAI sem crédito derruba a Ana (incidente 07/07)");
}

// ------------------------------------------------- guard de segredo faltando
{
  const { missing } = buildAnaStack({ ...FAKE, openaiKey: undefined, superlogicaAppToken: null });
  check(missing.includes("OPENROUTER_API_KEY"), "segredo ausente tem que entrar em missing (OPENROUTER_API_KEY)");
  check(missing.includes("SUPERLOGICA_APP_TOKEN"), "segredo null tem que entrar em missing (SUPERLOGICA_APP_TOKEN)");
}

// ---------------------------------------------------------------- imagem
{
  // A Ana é pinada por DIGEST de propósito: um deploy do Estagiário não pode movê-la, e
  // :latest aqui faria a Ana andar sozinha a cada push. É o oposto do ncs-chat.
  check(/@sha256:[a-f0-9]{64}$/.test(ANA_IMAGE), `ANA_IMAGE deve ser digest fixo, não tag: ${ANA_IMAGE}`);
  check(!ANA_IMAGE.endsWith(":latest"), ":latest na Ana = ela anda sozinha a cada push");
}

// ---------------------------------------------------------------- compose
{
  const { compose, env } = buildAnaStack(FAKE);
  check(compose.includes(`image: ${ANA_IMAGE}`), "compose não usa a imagem do módulo");
  check(compose.includes("container_name: ncs-agente"), "container_name errado");
  check(/container_name:\s*ncs-agente-redis/.test(compose), "serviço redis ausente do compose");
  check(compose.includes("ncs_agente_redis_data"), "volume do redis ausente (sessão do morador não sobrevive)");
  // O log de auditoria das escritas é exigência de LGPD/rastreio — volume nomeado, não efêmero.
  check(compose.includes("ncs_agente_audit_data:/data/audit"), "volume de auditoria ausente (log de escrita se perde no redeploy)");
  check(/depends_on:\s*\[redis\]/.test(compose), "ncs-agente sem depends_on:[redis]");

  // O redis não tem senha: não pode encostar na rede `edge`, que é externa/compartilhada.
  const blocoRedis = compose.slice(compose.indexOf("redis:\n    image: redis"));
  check(!/networks:\s*\[default,\s*edge\]/.test(blocoRedis), "redis SEM SENHA exposto na rede edge (compartilhada)");

  const semLinha = env.filter((e) => !compose.includes(`      - ${e.name}=${e.value ?? ""}`));
  check(semLinha.length === 0, `env que não virou linha do compose: ${semLinha.map((e) => e.name).join(", ")}`);
}

console.log(`test_deploy_ana_stack: ${ok}/${total} OK`);
