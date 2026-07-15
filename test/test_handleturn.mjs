// Teste end-to-end do loop do agente (LLM + tool consultar_regimento), usando Gemini via OpenAI-compat.
// Outbound -> dangerouslyDisableSandbox. Valida que a Ana chama a tool e responde CITANDO a fonte.
import fs from 'node:fs';

// ⚠️ Teste AO VIVO: chama o Gemini de verdade e lê a chave de `.tmp/`, que fica FORA do repo.
// Sem a chave ele PULA (exit 0) em vez de estourar — senão derruba o gate do CI (14/07) por
// falta de segredo, e não por bug. E no CI ele NÃO deve rodar mesmo: gastaria dinheiro a cada
// push e um teste de LLM é instável por natureza. O gate cobre os determinísticos; este é local.
const KEY = new URL('../../../.tmp/gemini_key.txt', import.meta.url);
if (!fs.existsSync(KEY)) {
  console.log('test_handleturn: PULADO (sem .tmp/gemini_key.txt — teste ao vivo, roda só na máquina do dev)');
  process.exit(0);
}
// configura o LLM ANTES de importar config/agent (config lê process.env no import)
process.env.OPENROUTER_API_KEY = fs.readFileSync(KEY, 'utf8').trim();
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
