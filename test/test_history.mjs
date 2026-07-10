// test_history.mjs — testes DETERMINÍSTICOS (sem LLM) da poda de histórico (F4).
// podarHistorico(messages, opts) é uma função pura: recebe o array de mensagens da sessão
// e devolve um NOVO array podado. Não muta a entrada.
// Uso: node test/test_history.mjs
import { podarHistorico } from '../src/history.mjs';

let failures = 0;
function assert(condition, label) {
  if (condition) console.log('  OK  ', label);
  else { console.error('  FAIL', label); failures++; }
}

console.log('\n=== test_history.mjs (poda de histórico F4) ===\n');

const SYS = { role: 'system', content: 'Você é a Ana...' }; // prompt principal (índice 0)

// Constrói um turno COMPLETO com consulta de regimento (bulky) e resposta final.
function turnoRegimento(userTxt, replyTxt, callId) {
  return [
    { role: 'user', content: userTxt },
    { role: 'assistant', content: null, tool_calls: [{ id: callId, type: 'function', function: { name: 'consultar_regimento', arguments: '{"pergunta":"pet"}' } }], extra_content: { google: { thought_signature: 'SIG-' + callId } } },
    { role: 'tool', tool_call_id: callId, name: 'consultar_regimento', content: JSON.stringify({ encontrou: true, trechos: [{ fonte: 'Regimento XXVII', texto: 'x'.repeat(1500) }] }) },
    { role: 'assistant', content: replyTxt },
  ];
}
function turnoTexto(userTxt, replyTxt) {
  return [
    { role: 'user', content: userTxt },
    { role: 'assistant', content: replyTxt },
  ];
}

// ── 1. system principal SEMPRE preservado (índice 0, verbatim) ──────────────────
{
  const msgs = [SYS, ...turnoRegimento('a', 'ra', 'c1'), ...turnoTexto('b', 'rb'), ...turnoTexto('c', 'rc')];
  const out = podarHistorico(msgs, { cap: 40, keepTurns: 2 });
  assert(out[0] && out[0].role === 'system' && out[0].content === SYS.content, 'system principal preservado verbatim no índice 0');
  assert(out.filter((m) => m.role === 'system').length === 1, 'não duplica nem cria system extra');
}

// ── 2. resultado de tool ANTIGO (fora da janela) é STUBado ──────────────────────
{
  // Turno 0 tem regimento; depois 3 turnos de texto → regimento fica > 2 turnos atrás.
  const msgs = [SYS, ...turnoRegimento('a', 'ra', 'c1'), ...turnoTexto('b', 'rb'), ...turnoTexto('c', 'rc'), ...turnoTexto('d', 'rd')];
  const out = podarHistorico(msgs, { cap: 40, keepTurns: 2 });
  const tool = out.find((m) => m.role === 'tool' && m.tool_call_id === 'c1');
  assert(!!tool, 'a mensagem role:tool antiga continua presente (não removida — pairing intacto)');
  const parsed = JSON.parse(tool.content);
  assert(!!parsed.resumo && /consultar_regimento/.test(parsed.resumo), 'content do tool antigo virou stub {resumo:...} citando o nome da tool');
  assert(tool.content.length < 200, 'stub é curto (livrou os ~1,5k tok do trecho)');
  assert(tool.tool_call_id === 'c1' && tool.name === 'consultar_regimento' && tool.role === 'tool', 'stub preserva role/tool_call_id/name (integridade da API)');
}

// ── 3. resultado de tool RECENTE (dentro da janela keepTurns) NÃO é stubado ──────
{
  // regimento no penúltimo turno (dentro dos últimos 2) → mantém verbatim.
  const msgs = [SYS, ...turnoTexto('a', 'ra'), ...turnoRegimento('b', 'rb', 'c2'), ...turnoTexto('c', 'rc')];
  const out = podarHistorico(msgs, { cap: 40, keepTurns: 2 });
  const tool = out.find((m) => m.role === 'tool' && m.tool_call_id === 'c2');
  assert(tool && /trechos/.test(tool.content) && tool.content.length > 500, 'tool recente (últimos 2 turnos) mantém o conteúdo original');
}

// ── 4. resolver_cadastro NUNCA é stubado (contexto de identidade vivo) ───────────
{
  const cadastro = JSON.stringify({ encontrado: true, unidades: [{ id_unidade: '99', identificacao: 'Bl7 ap401', condominio: 'Lume', id_condominio: '179', papel: 'proprietario', nome: 'Fulano' }] });
  const msgs = [SYS,
    { role: 'user', content: 'meu cpf é 111' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'rc1', type: 'function', function: { name: 'resolver_cadastro', arguments: '{"cpf":"111"}' } }] },
    { role: 'tool', tool_call_id: 'rc1', name: 'resolver_cadastro', content: cadastro },
    { role: 'assistant', content: 'Achei sua unidade!' },
    ...turnoTexto('b', 'rb'), ...turnoTexto('c', 'rc'), ...turnoTexto('d', 'rd'),
  ];
  const out = podarHistorico(msgs, { cap: 40, keepTurns: 2 });
  const tool = out.find((m) => m.role === 'tool' && m.tool_call_id === 'rc1');
  assert(tool && tool.content === cadastro, 'resolver_cadastro antigo mantém o cadastro completo (identidade não é esquecida)');
}

// ── 5. mensagens de NUDGE consumidas (retry-vazio + G1) são removidas ────────────
{
  const NUDGE_VAZIO = { role: 'system', content: 'Escreva AGORA a resposta ao usuário, curta e clara, com base no que as ferramentas já retornaram. Não responda vazio.' };
  const NUDGE_G1 = { role: 'system', content: 'Você indicou que vai encaminhar/transferir, mas NÃO chamou a ferramenta transferir_humano. Se realmente é caso de encaminhar, chame transferir_humano AGORA (motivo mais específico + resumo). Se não for, responda normalmente, sem prometer encaminhamento.' };
  const msgs = [SYS,
    { role: 'user', content: 'a' }, NUDGE_VAZIO, { role: 'assistant', content: 'ra' },
    { role: 'user', content: 'b' }, { role: 'assistant', content: 'rb-pre' }, NUDGE_G1, { role: 'assistant', content: 'rb' },
  ];
  const out = podarHistorico(msgs, { cap: 40, keepTurns: 2 });
  assert(!out.some((m) => m.role === 'system' && m.content.startsWith('Escreva AGORA')), 'nudge retry-de-vazio removido');
  assert(!out.some((m) => m.role === 'system' && m.content.startsWith('Você indicou que vai')), 'nudge G1 removido');
  assert(out.some((m) => m.role === 'assistant' && m.content === 'rb'), 'resposta final real preservada');
}

// ── 6. extra_content (thought_signature) do assistant tool_calls é preservado ────
{
  const msgs = [SYS, ...turnoRegimento('a', 'ra', 'c1'), ...turnoTexto('b', 'rb'), ...turnoTexto('c', 'rc'), ...turnoTexto('d', 'rd')];
  const out = podarHistorico(msgs, { cap: 40, keepTurns: 2 });
  const ac = out.find((m) => m.role === 'assistant' && m.tool_calls);
  assert(ac && ac.extra_content && ac.extra_content.google.thought_signature === 'SIG-c1', 'extra_content/thought_signature do assistant tool_calls preservado após stub do tool');
  assert(ac.tool_calls[0].id === 'c1', 'assistant tool_calls intacto (id do call preservado)');
}

// ── 7. CAP: excedeu o teto → dropa turnos INTEIROS mais antigos, sem órfão ───────
{
  // system + 10 turnos de texto (2 msgs cada) = 21 msgs. cap=8 → mantém system + ~3 turnos finais.
  const turns = [];
  for (let i = 0; i < 10; i++) turns.push(...turnoTexto('u' + i, 'r' + i));
  const msgs = [SYS, ...turns];
  const out = podarHistorico(msgs, { cap: 8, keepTurns: 2 });
  assert(out.length <= 8, `cap respeitado (out.length=${out.length} <= 8)`);
  assert(out[0].role === 'system', 'system preservado sob cap');
  assert(out.some((m) => m.role === 'user' && m.content === 'u9'), 'turno mais recente (u9) preservado sob cap');
  assert(!out.some((m) => m.role === 'user' && m.content === 'u0'), 'turno mais antigo (u0) dropado sob cap');
  // integridade: primeira msg não-system tem que ser um user (corte em fronteira de turno)
  const firstNonSys = out.find((m) => m.role !== 'system');
  assert(firstNonSys && firstNonSys.role === 'user', 'corte do cap cai em fronteira de turno (começa com user)');
}

// ── 8. CAP nunca orfaniza tool: assistant(tool_calls)↔tool sempre em par ─────────
{
  const turns = [];
  for (let i = 0; i < 8; i++) turns.push(...turnoRegimento('u' + i, 'r' + i, 'c' + i));
  const msgs = [SYS, ...turns]; // system + 8×4 = 33 msgs
  const out = podarHistorico(msgs, { cap: 12, keepTurns: 2 });
  // invariante 1: todo role:tool tem um assistant tool_calls ANTES com o mesmo id
  const ids = new Set();
  for (const m of out) if (m.role === 'assistant' && m.tool_calls) for (const tc of m.tool_calls) ids.add(tc.id);
  const orfaos = out.filter((m) => m.role === 'tool' && !ids.has(m.tool_call_id));
  assert(orfaos.length === 0, 'nenhum role:tool órfão (todo tool tem seu assistant tool_calls no par)');
  // invariante 2: todo assistant tool_calls tem o(s) tool response(s) logo depois
  let dangling = 0;
  for (let i = 0; i < out.length; i++) {
    const m = out[i];
    if (m.role === 'assistant' && m.tool_calls) {
      for (const tc of m.tool_calls) {
        const hasResp = out.slice(i + 1).some((x) => x.role === 'tool' && x.tool_call_id === tc.id);
        if (!hasResp) dangling++;
      }
    }
  }
  assert(dangling === 0, 'nenhum assistant tool_calls sem resposta de tool (par completo)');
}

// ── 9. NÃO muta a entrada (pureza) ──────────────────────────────────────────────
{
  const msgs = [SYS, ...turnoRegimento('a', 'ra', 'c1'), ...turnoTexto('b', 'rb'), ...turnoTexto('c', 'rc'), ...turnoTexto('d', 'rd')];
  const snapshot = JSON.stringify(msgs);
  podarHistorico(msgs, { cap: 40, keepTurns: 2 });
  assert(JSON.stringify(msgs) === snapshot, 'array de entrada não é mutado (função pura)');
}

// ── 10. user messages nunca são alteradas (o CPF/nome ditos ficam p/ re-consulta) ─
{
  const msgs = [SYS,
    { role: 'user', content: 'meu cpf é 12345678900' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'rc1', type: 'function', function: { name: 'resolver_cadastro', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'rc1', name: 'resolver_cadastro', content: '{"encontrado":true}' },
    { role: 'assistant', content: 'ok' },
    ...turnoTexto('b', 'rb'), ...turnoTexto('c', 'rc'), ...turnoTexto('d', 'rd'), ...turnoTexto('e', 're'),
  ];
  const out = podarHistorico(msgs, { cap: 40, keepTurns: 2 });
  assert(out.some((m) => m.role === 'user' && m.content === 'meu cpf é 12345678900'), 'mensagem do user com o CPF preservada (permite re-consulta sem re-perguntar)');
}

// ── 11. no-op quando o histórico é curto (nada a podar) ─────────────────────────
{
  const msgs = [SYS, ...turnoRegimento('a', 'ra', 'c1'), ...turnoTexto('b', 'rb')];
  const out = podarHistorico(msgs, { cap: 40, keepTurns: 2 });
  const tool = out.find((m) => m.role === 'tool');
  assert(tool && /trechos/.test(tool.content), 'histórico curto: tool recente intacto (sem poda prematura)');
  assert(out.length === msgs.length, 'histórico curto: nenhuma msg removida');
}

console.log('\n' + (failures === 0 ? '✓ Todos os testes passaram.' : `✗ ${failures} teste(s) FALHARAM.`) + '\n');
process.exit(failures > 0 ? 1 : 0);
