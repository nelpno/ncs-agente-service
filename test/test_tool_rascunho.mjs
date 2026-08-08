// test_tool_rascunho.mjs — a tool cria rascunho e popula ctx.draft, sem write real (DRY_RUN)
// Carrega .env (raiz do projeto) para ter tokens do Superlógica disponíveis no checarConflito (leitura).
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../../..', '.env'); // agente-service/test/ → raiz NCS
try {
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !m[1].startsWith('COLE_') && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* sem .env — tokens podem estar já no env */ }

process.env.DRY_RUN_WRITES = 'true';
import { runToolReal, TOOLS } from '../src/agent.mjs';
import { cadastroInquilino } from '../src/write/actions/cadastro_inquilino.mjs';
cadastroInquilino.snapshot = async () => ([]);
cadastroInquilino.checarConflito = async () => ({ conflito: false, candidatos: [] });
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

ok(TOOLS.some((t) => t.function.name === 'criar_rascunho_cadastro'), 'tool registrada em TOOLS');
const ctx = { chatId: null };
const r = await runToolReal('criar_rascunho_cadastro', { id_condominio: '179', id_unidade: '900', nome: 'João Silva', papel: 'inquilino', data_entrada: '06/30/2026', cpf: '52998224725', email: 'joao@x.com', telefone: '16999998888' }, ctx);
ok(r.criado === true && r.aguardando_aprovacao === true, 'retorna criado + aguardando_aprovacao');
ok(Array.isArray(ctx.draft) && ctx.draft[0]?.url.includes('/aprovacao/'), 'ctx.draft populado com url');
const inval = await runToolReal('criar_rascunho_cadastro', { id_condominio: '179', nome: 'X' }, { chatId: null });
ok(inval.criado === false && Array.isArray(inval.erros), 'campos faltando → criado:false + erros');

// ── A data chega em BR e é convertida AQUI, não pelo modelo (caso 16 do teste dos 20) ──────────────
// Este é o pino da FIAÇÃO; o da regra está em test_datas_br.mjs. Ele lê o que ficou GRAVADO no
// rascunho, não o que a tool respondeu — foi assim que a data invertida passou despercebida na
// primeira vez (a frase da Ana estava certa; o campo é que estava errado).
const { getDraftByToken } = await import('../src/write/drafts.mjs');
const ctxBr = { chatId: null };
const rBr = await runToolReal('criar_rascunho_cadastro', { id_condominio: '179', id_unidade: '900', nome: 'Antônio Duarte Prado', papel: 'dependente', data_entrada: '05/08/2026' }, ctxBr);
ok(rBr.criado === true, 'data em DD/MM/AAAA → rascunho criado');
const draftBr = await getDraftByToken(ctxBr.draft[0].token);
ok(draftBr?.dados?.data_entrada === '08/05/2026', `CASO 16: "05/08/2026" gravado como 08/05/2026 (5 de agosto), veio "${draftBr?.dados?.data_entrada}"`);

// Data impossível NÃO vira rascunho — a Ana pergunta de novo em vez de gravar uma data chutada.
const rRuim = await runToolReal('criar_rascunho_cadastro', { id_condominio: '179', id_unidade: '900', nome: 'Fulano', papel: 'dependente', data_entrada: '30/02/2026' }, { chatId: null });
ok(rRuim.criado === false && rRuim.motivo === 'data_invalida', '30 de fevereiro → criado:false motivo:data_invalida');
ok(/dia|m[eê]s|calend/i.test((rRuim.erros || []).join(' ')), 'o erro explica o que pedir de novo');

// O CONTRATO da tool tem de dizer DD/MM. Se alguém trocar para MM/DD, o modelo volta a converter —
// e a conversão do código converteria de novo, invertendo tudo outra vez, em silêncio.
const schemaCad = TOOLS.find((t) => t.function.name === 'criar_rascunho_cadastro').function.parameters.properties;
ok(/DD\/MM\/AAAA/.test(schemaCad.data_entrada.description), 'schema pede a data em DD/MM/AAAA');
ok(!/MM\/DD/.test(schemaCad.data_entrada.description), 'schema NÃO pede MM/DD (dupla conversão)');
ok(/DD\/MM\/AAAA/.test(schemaCad.data_nascimento.description) && !/MM\/DD/.test(schemaCad.data_nascimento.description), 'nascimento também em DD/MM/AAAA');
console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
