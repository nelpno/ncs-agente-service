// test_condo_explicito.mjs — AO VIVO (LLM real): o condomínio NOMEADO na mensagem vence o da sessão.
//
// Regressão do caso real de 16/07/2026 (Luciana, log `interacoes`): ela perguntou do Allure às 08:47 e,
// 1h depois, "Reserva do Campo o que diz na convenção sobre destinação de área?" — o loop chamou
// consultar_regimento({condominio:"Allure"}) e respondeu a regra do condomínio ERRADO citando artigo.
// É o C23 da Ana ("Reserva do Campo" = NOME do condo, não "reservar área comum"), que nunca foi
// portado pro Estagiário (prompts separados).
//
// Pula sem chave (não roda no CI — custa chamada de LLM). Rodar: node test/test_condo_explicito.mjs
// REPS=6 node test/test_condo_explicito.mjs   → mede a taxa (é LLM: 1 run não prova nada).
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const NCS = path.join(DIR, "..", "..", "..", ".."); // .../Agents/NCS

function envDoDotEnv(nomes) {
  try {
    const txt = fs.readFileSync(path.join(NCS, ".env"), "utf8");
    for (const l of txt.split(/\r?\n/)) {           // CRLF-safe; last-wins ignorando placeholder COLE_*
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && nomes.includes(m[1]) && !/^COLE_/.test(m[2].trim())) return m[2].trim();
    }
  } catch {}
  return "";
}
const KEY = (() => {
  try { const k = fs.readFileSync(path.join(NCS, ".tmp", "openai_key.txt"), "utf8").replace(/\r/g, "").trim(); if (k) return k; } catch {}
  return envDoDotEnv(["OPENAI_API_KEY", "OPENROUTER_API_KEY"]);
})();

if (!KEY) {
  console.log("SKIP test_condo_explicito: sem chave de LLM (teste AO VIVO, não roda no CI).");
  process.exit(0);
}

// config lê env no import → setar ANTES de importar agent.mjs
process.env.OPENROUTER_API_KEY = KEY;
process.env.OPENROUTER_BASE_URL = "https://api.openai.com/v1";
process.env.AGENT_MODEL = process.env.STRESS_MODEL || "gpt-5.4";
process.env.SESSION_SECRET = "x";

const { handleTurn } = await import("../src/agent.mjs");

const REPS = Number(process.env.REPS || 1);
const T1 = "condomínio Allure com quantos dias de antecedência tem que fazer reserva do salão de festas?";
const T2 = "Reserva do Campo o que diz na convenção sobre destinação de área?";

const condoDe = (toolsUsed) =>
  (toolsUsed || []).filter((t) => t.name === "consultar_regimento").map((t) => String(t.args?.condominio || ""));

let falhas = 0;
for (let i = 1; i <= REPS; i++) {
  const session = { messages: [] };
  await handleTurn(session, T1, {});                       // turno 1: fixa o Allure no contexto
  const r2 = await handleTurn(session, T2, {});            // turno 2: nomeia OUTRO condomínio
  const condos = condoDe(r2.toolsUsed);

  const errado = condos.some((c) => /allure/i.test(c));
  const certo = condos.some((c) => /reserva|campo|piemonte/i.test(c));
  const ok = !errado && certo;
  if (!ok) falhas++;
  console.log(
    `  rep ${i}/${REPS}: consultar_regimento(condominio=${JSON.stringify(condos)}) ` +
    (ok ? "OK" : errado ? "❌ USOU O CONDOMÍNIO DA SESSÃO (Allure)" : "❌ não consultou o condomínio nomeado")
  );
  if (!ok) console.log("     reply: " + String(r2.reply || "").replace(/\s+/g, " ").slice(0, 160));
}

console.log(`\n${REPS - falhas}/${REPS} corretos — o condomínio nomeado no turno tem que vencer o da sessão.`);
assert.strictEqual(falhas, 0, `${falhas}/${REPS} consultaram o condomínio ERRADO (regressão do C23 no Estagiário)`);
console.log("test_condo_explicito OK");
