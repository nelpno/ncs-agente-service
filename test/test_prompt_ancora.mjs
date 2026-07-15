// test_prompt_ancora.mjs — deploy de prompt tem que pegar em sessão VIVA.
//
// CASO REAL (15/07, 20:28): a Ana foi deployada 20:24 com a regra nova ("de ambos"), o Nelson
// testou 4min depois e ela AINDA recusava. A imagem estava certa; a SESSÃO dele (criada 20:02)
// é que carregava o system prompt ANTIGO — o prompt só era inserido quando `messages` estava vazio.
// Efeito colateral da memória por MORADOR + janela de 120min: antes, cada conversa nova nascia com
// o prompt fresco; agora a sessão vive por horas e congelava a versão velha do prompt junto.
// Uso: node test/test_prompt_ancora.mjs

import { _ancorarSystemPrompt } from '../src/agent.mjs';

let failures = 0;
function assert(c, label) { if (c) console.log('  OK  ', label); else { console.error('  FAIL', label); failures++; } }

console.log('\n=== test_prompt_ancora.mjs ===\n');

// 1. Sessão nova → insere (comportamento de sempre)
{
  const s = { messages: [] };
  const r = _ancorarSystemPrompt(s, 'PROMPT A');
  assert(r === 'inserido', 'sessão vazia → insere o system prompt');
  assert(s.messages[0].role === 'system' && s.messages[0].content === 'PROMPT A', '  (na posição 0)');
}

// 2. O BUG: sessão viva com prompt VELHO → tem que receber o NOVO
{
  const s = { messages: [{ role: 'system', content: 'PROMPT VELHO' }, { role: 'user', content: '2 via' }] };
  const r = _ancorarSystemPrompt(s, 'PROMPT NOVO');
  assert(r === 'atualizado', 'sessão viva com prompt velho → ATUALIZA (o deploy pega)');
  assert(s.messages[0].content === 'PROMPT NOVO', '  (a msg [0] agora é o prompt novo)');
  assert(s.messages[1].content === '2 via', '  (o histórico da conversa é preservado)');
  assert(s.messages.length === 2, '  (não duplica o system)');
}

// 3. Prompt igual → não mexe (não quebrar o cache de prefixo à toa)
{
  const s = { messages: [{ role: 'system', content: 'PROMPT A' }, { role: 'user', content: 'oi' }] };
  const r = _ancorarSystemPrompt(s, 'PROMPT A');
  assert(r === 'ok', 'prompt igual → não mexe (preserva o cache da OpenAI)');
}

// 4. Sessão legada cuja [0] não é system → não corrompe
{
  const s = { messages: [{ role: 'user', content: 'oi' }] };
  const r = _ancorarSystemPrompt(s, 'PROMPT A');
  assert(r === 'ok' && s.messages[0].role === 'user', 'msg[0] não-system → não sobrescreve a fala do morador');
}

console.log('\n' + (failures === 0 ? '✓ Todos os testes passaram.' : `✗ ${failures} teste(s) FALHARAM.`) + '\n');
process.exit(failures > 0 ? 1 : 0);
