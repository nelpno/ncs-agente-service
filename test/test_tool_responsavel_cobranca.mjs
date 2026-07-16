// test_tool_responsavel_cobranca.mjs — a Ana consegue MESMO informar quem recebe o boleto?
// Prova o caminho inteiro: schema da tool → runToolReal → dados gravados no draft → payload do Superlógica.
// (O test_responsavel_cobranca.mjs cobre a regra; este cobre a fiação — sem ela a pergunta do
//  Fernando fica só no prompt e o campo nunca chega na ação.)
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  for (const line of readFileSync(resolve(__dirname, '../../..', '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !m[1].startsWith('COLE_') && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* tokens podem já estar no env */ }
process.env.DRY_RUN_WRITES = 'true';

import { runToolReal, TOOLS } from '../src/agent.mjs';
import { cadastroInquilino } from '../src/write/actions/cadastro_inquilino.mjs';
import { getDraft } from '../src/write/drafts.mjs';
cadastroInquilino.snapshot = async () => ([]);
cadastroInquilino.checarConflito = async () => ({ conflito: false, candidatos: [] });
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

// 1) o schema expõe o campo (senão o modelo não tem como mandar)
const tool = TOOLS.find((t) => t.function.name === 'criar_rascunho_cadastro');
const prop = tool?.function?.parameters?.properties?.responsavel_cobranca;
ok(!!prop, 'schema da tool expõe responsavel_cobranca');
ok(Array.isArray(prop?.enum) && prop.enum.includes('proprietario') && prop.enum.includes('inquilino'),
  'schema restringe a proprietario|inquilino (enum evita valor inventado)');

// 2) pass-through: o que a Ana manda chega no draft
const base = { id_condominio: '179', id_unidade: '900', nome: 'João Silva', papel: 'inquilino', data_entrada: '06/30/2026', cpf: '12345678901' };
const rInq = await runToolReal('criar_rascunho_cadastro', { ...base, responsavel_cobranca: 'inquilino' }, { chatId: null });
ok(rInq.criado === true, 'cria rascunho com responsavel_cobranca=inquilino');
const dInq = await getDraft(rInq.protocolo);
ok(dInq?.dados?.responsavel_cobranca === 'inquilino', 'draft guarda responsavel_cobranca=inquilino');
ok(cadastroInquilino.montarPayload(dInq.dados)['contatos[0][ID_TIPORESP_TRES]'] === '7',
  'payload do draft → ID_TIPORESP_TRES=7 (ponta a ponta)');

// 3) omitir o campo continua funcionando e mantém o default seguro
const rDef = await runToolReal('criar_rascunho_cadastro', base, { chatId: null });
const dDef = await getDraft(rDef.protocolo);
ok(cadastroInquilino.montarPayload(dDef.dados)['contatos[0][ID_TIPORESP_TRES]'] === '4',
  'sem o campo → 4 (proprietário recebe) — comportamento atual preservado');

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
