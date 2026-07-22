// test_titularidade_tool.mjs — a tool criar_rascunho_titularidade fica ESCONDIDA até TITULARIDADE_ENABLED=1.
// Onda C: sem a flag, a Ana nem vê a tool → segue mandando o formulário de titularidade (comportamento de
// hoje). Garante que commitar/deployar o wiring NÃO muda o comportamento da Ana em prod.
import assert from 'node:assert';
delete process.env.TITULARIDADE_ENABLED; // estado limpo antes do import (o filtro é por env em runtime)
const { toolsAtivas } = await import('../src/agent.mjs');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const nomes = () => toolsAtivas().map((t) => t.function.name);

// default (flag off) → tool ESCONDIDA
delete process.env.TITULARIDADE_ENABLED;
ok(!nomes().includes('criar_rascunho_titularidade'), 'flag off: tool escondida (Ana intocada em prod)');
ok(nomes().includes('criar_rascunho_cadastro'), 'cadastro segue visível (não gated)');

// flag on → tool aparece p/ o LLM
process.env.TITULARIDADE_ENABLED = '1';
ok(nomes().includes('criar_rascunho_titularidade'), 'flag on: tool aparece');
delete process.env.TITULARIDADE_ENABLED;
ok(!nomes().includes('criar_rascunho_titularidade'), 'flag removida de novo: some (env em runtime, não no import)');

console.log(`test_titularidade_tool: ${n}/${n} OK`);
