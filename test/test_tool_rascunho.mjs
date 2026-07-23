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
const r = await runToolReal('criar_rascunho_cadastro', { id_condominio: '179', id_unidade: '900', nome: 'João Silva', papel: 'inquilino', data_entrada: '06/30/2026', cpf: '12345678901', email: 'joao@x.com', telefone: '16999998888' }, ctx);
ok(r.criado === true && r.aguardando_aprovacao === true, 'retorna criado + aguardando_aprovacao');
ok(Array.isArray(ctx.draft) && ctx.draft[0]?.url.includes('/aprovacao/'), 'ctx.draft populado com url');
const inval = await runToolReal('criar_rascunho_cadastro', { id_condominio: '179', nome: 'X' }, { chatId: null });
ok(inval.criado === false && Array.isArray(inval.erros), 'campos faltando → criado:false + erros');
console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
