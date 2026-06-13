// Teste end-to-end do loop do agente (LLM + tool consultar_regimento), usando Gemini via OpenAI-compat.
// Outbound -> dangerouslyDisableSandbox. Valida que a Ana chama a tool e responde CITANDO a fonte.
import fs from 'node:fs';

// configura o LLM ANTES de importar config/agent (config lê process.env no import)
process.env.OPENROUTER_API_KEY = fs.readFileSync(new URL('../../../.tmp/gemini_key.txt', import.meta.url), 'utf8').trim();
process.env.OPENROUTER_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
process.env.AGENT_MODEL = process.env.AGENT_MODEL || 'gemini-2.5-flash';

const { handleTurn } = await import('../src/agent.mjs');

const session = { messages: [] };
const ctx = { chatId: null, fluxo: {} }; // sem Octadesk: marcar_tag/transferir não disparam REST (ctx.chatId null)

const turnos = [
  'Oi! Eu moro no condominio Lume. Posso ter cachorro no apartamento?',
  'E qual o horario permitido pra fazer mudanca?',
  'Voces tem convenio ou desconto com alguma academia aqui perto?',
];

for (const t of turnos) {
  console.log('\n──────────────────────────────────────');
  console.log('MORADOR:', t);
  const r = await handleTurn(session, t, ctx);
  console.log('ANA    :', r.reply);
  if (r.transferred) console.log('   [transferido]', JSON.stringify(r.transferred));
}
console.log('\n(turns concluídos)');
