// test_condominio_nome.mjs — o nome do condomínio chega ao rascunho?
//
// Bug visto AO VIVO na reunião com o Fernando (15/07), na auditoria da aprovação real:
//   conectores: { aviso: { ok:false, motivo:"condominio_nao_resolvido", condominio:null, enfileirados:0 } }
// O posGravar resolve a portaria/síndico pelo NOME do condomínio (dados.condominio_nome). Veio null
// → nenhum aviso enfileirado. Ou seja: com a escrita real ligada, a portaria e o síndico NÃO seriam
// avisados — que é METADE da Onda 1 (e exatamente o fluxo que o Fernando validou na reunião:
// portaria humana → WhatsApp do grupo + síndico; remota → e-mail + síndico).
//
// Causa: o ctx morre a cada requisição; o resolver_cadastro descobre o nome no 1º turno e o rascunho
// nasce no 4º. Mesma classe do rótulo da unidade.
//
// Por que um MAPA id→nome e não persistir o ctx.lastCondo: o get_boleto_2via faz
// `ctx.lastCondo = { id: novo_id, nome: ctx.lastCondo?.nome }` — trocar de condomínio mantém o nome
// ANTIGO. Persistir isso entre turnos espalharia o nome errado. O mapa nunca desalinha.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  for (const l of readFileSync(resolve(__dirname, '../../..', '.env'), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !m[1].startsWith('COLE_') && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}
process.env.DRY_RUN_WRITES = 'true';

import { runToolReal } from '../src/agent.mjs';
import { cadastroInquilino } from '../src/write/actions/cadastro_inquilino.mjs';
import { getDraft } from '../src/write/drafts.mjs';
cadastroInquilino.snapshot = async () => ([]);
cadastroInquilino.checarConflito = async () => ({ conflito: false, candidatos: [] });
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

const base = { id_condominio: '181', id_unidade: '14381', nome: 'Marcos Ribeiro', data_entrada: '08/01/2026', cpf: '12345678901', email: 'marcos@x.com', telefone: '16999990000' };

// turno 4: ctx NOVO, mas a sessão trouxe o que o resolver_cadastro colheu no turno 1
const ctx = { chatId: null, unidades: { '14381': 'QUADRA 20 / LOTE 0314' }, condominios: { '181': 'Reserva do Campo' } };
const r = await runToolReal('criar_rascunho_cadastro', base, ctx);
const d = await getDraft(r.protocolo);
ok(d?.dados?.condominio_nome === 'Reserva do Campo',
  `draft leva o NOME do condomínio (sem ele o aviso não sai) — veio: ${d?.dados?.condominio_nome}`);

// o card mostra o nome, não o id de banco
const rend = cadastroInquilino.render(d.dados, []);
ok(rend.campos.some((c) => c.label === 'Condomínio' && c.valor === 'Reserva do Campo'),
  'card mostra "Reserva do Campo", não "181"');

// condomínio que a sessão não viu → null, sem inventar nome
const ctx2 = { chatId: null, condominios: {} };
const r2 = await runToolReal('criar_rascunho_cadastro', { ...base, id_condominio: '999' }, ctx2);
const d2 = await getDraft(r2.protocolo);
ok(!d2?.dados?.condominio_nome, 'condomínio não visto → nome null (não inventa)');

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
