// test_aviso_lgpd.mjs — GUARDA da decisão de LGPD sobre o aviso que vai à portaria/síndico.
//
// Decisão (Nelson, 24/07, respondendo à pergunta que o Fernando deixou aberta): o aviso leva
// **apenas nome, unidade, data da mudança e se é entrada ou saída**. Sem CPF (nunca teve) e **sem
// telefone** (tinha até 24/07 — saiu). O aviso cai num GRUPO de WhatsApp com porteiros de turnos
// diferentes: o que entra ali não volta atrás.
//
// Por que este teste existe: ao remover o telefone dos templates, TODA a suíte continuou verde —
// `test_portaria_dispatch`, `test_outbox`, `test_templates` e `test_condominio_contatos` não olham o
// CONTEÚDO do aviso. Sem guarda, um `git revert` distraído ou uma re-geração de template devolve o
// telefone ao grupo da portaria e ninguém percebe. Já aconteceu com decisões do Fernando antes
// (a regra da terceirização "sumiu" numa versão e ele cobrou).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planejarAviso, _reload } from '../src/portaria_dispatch.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TPL = path.join(__dirname, '..', 'data', 'templates');
let ok = 0, total = 0;
const falhas = [];
const check = (c, m) => { total++; if (c) ok++; else falhas.push(m); };

// ── 1) os templates de aviso não podem PEDIR telefone nem CPF ──
{
  for (const f of fs.readdirSync(TPL).filter((x) => /^(cadastro|titularidade)-(portaria|sindico)\.md$/.test(x))) {
    const t = fs.readFileSync(path.join(TPL, f), 'utf8');
    check(!/\{\{\s*telefone\s*\}\}/i.test(t), `${f} voltou a incluir {{telefone}} — o aviso não leva telefone (LGPD, 24/07)`);
    check(!/\{\{\s*(cpf|cpf_cnpj|documento)\s*\}\}/i.test(t), `${f} incluiu CPF/documento — proibido no aviso`);
    check(!/telefone|celular/i.test(t.replace(/\{\{.*?\}\}/g, '')), `${f} tem o RÓTULO "Telefone/Celular" no texto fixo`);
  }
}

// ── 2) o aviso REAL (renderizado) traz o que a portaria precisa e nada além ──
{
  _reload();
  const contatos = { lume: { sindico_nome: 'SÍNDICO TESTE', sindico_whatsapp: '5516999999999', portaria_grupo_jid: '123@g.us' } };
  // data no formato do Superlógica (MM/DD/AAAA) — o dispatch converte para BR na exibição
  const ator = { nome: 'MARIA DA SILVA', unidade: '101', papel: 'inquilino', data: '08/01/2026',
    telefone: '5516988887777', cpf: '12345678901' };   // telefone/CPF vão no ator e NÃO podem sair no texto
  const r = await planejarAviso({ evento: 'cadastro', condominio: 'Lume', ator, contatos });
  check(r.ok, 'planejarAviso resolveu o condomínio');
  for (const d of r.destinos) {
    const txt = d.payload || '';
    check(/MARIA DA SILVA/.test(txt), `${d.papel}: falta o nome`);
    check(/101/.test(txt), `${d.papel}: falta a unidade`);
    check(/01\/08\/2026/.test(txt), `${d.papel}: falta a data da mudança (formato BR)`);
    check(/Entrada/i.test(txt), `${d.papel}: falta indicar entrada/saída`);
    // o que NÃO pode aparecer
    check(!/988887777|5516988887777/.test(txt), `🔴 ${d.papel}: o TELEFONE vazou no aviso — ${txt.slice(0, 120)}`);
    check(!/12345678901|123\.456\.789/.test(txt), `🔴 ${d.papel}: o CPF vazou no aviso`);
  }
}

// ── 3) saída de inquilino (backlog do Fernando) já sai correta quando o chamador informar ──
{
  _reload();
  const contatos = { lume: { sindico_whatsapp: '5516999999999' } };
  const r = await planejarAviso({ evento: 'cadastro', condominio: 'Lume',
    ator: { nome: 'JOÃO', unidade: '202', data: '08/10/2026', movimento: 'saida' }, contatos });
  const txt = (r.destinos.find((d) => d.papel === 'sindico') || {}).payload || '';
  check(/Sa[íi]da/i.test(txt), `movimento='saida' devia sair "Saída" no aviso: ${txt.slice(0, 120)}`);
  check(!/Entrada/i.test(txt), `com movimento='saida' não pode dizer "Entrada": ${txt.slice(0, 120)}`);
}

if (falhas.length) { for (const f of falhas) console.error(`  ✗ ${f}`); assert.fail(`test_aviso_lgpd: ${falhas.length} de ${total} falharam`); }
console.log(`test_aviso_lgpd: ${ok}/${total} OK`);
