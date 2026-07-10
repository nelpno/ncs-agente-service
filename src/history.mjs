// history.mjs — poda de histórico da sessão (F4). Função PURA e determinística (sem LLM).
//
// Problema: session.messages só cresce dentro do TTL de 48h. Cada consulta de regimento
// (~1,7k tok) e cada retorno de tool fica para sempre e é re-enviado TODO turno.
//
// Estratégia (anti-alucinação POSITIVA): resultados de tool ANTIGOS (fora da janela dos
// últimos `keepTurns` turnos) e não-essenciais viram um STUB "consulte de novo" — re-consultar
// dado fresco (tools locais/baratas) é mais seguro que citar histórico velho.
//
// O QUE NUNCA É TOCADO (o piso): o system principal; as mensagens do USER (o CPF/nome ditos
// ficam para re-consulta); o assistant tool_calls e seu extra_content/thought_signature;
// e o resultado de resolver_cadastro (identidade/unidade viva). Só o CONTEÚDO de resultados
// de tool antigos e volumosos é encolhido — a mensagem role:'tool' permanece (pairing da API).

// Tools cujo RESULTADO nunca é stubado: carregam estado vivo (identidade/unidade, rascunho).
const EXEMPT_TOOLS = new Set(['resolver_cadastro', 'criar_rascunho_cadastro']);

// Nudges de sistema injetados no meio do loop (já consumidos ao fim do turno) — podem sair.
const NUDGE_PREFIXES = ['Escreva AGORA a resposta', 'Você indicou que vai encaminhar'];

function isNudge(m) {
  return m.role === 'system' && typeof m.content === 'string' && NUDGE_PREFIXES.some((p) => m.content.startsWith(p));
}

function stubDe(name) {
  return JSON.stringify({ resumo: `${name || 'ferramenta'} consultada em turno anterior; se precisar do dado, consulte de novo` });
}

/**
 * podarHistorico(messages, { cap, keepTurns }) → NOVO array podado (não muta a entrada).
 * - cap: teto de mensagens; acima disso dropa TURNOS inteiros mais antigos (fronteira segura).
 * - keepTurns: nº de turnos recentes que mantêm o resultado de tool verbatim.
 */
export function podarHistorico(messages, opts = {}) {
  const cap = opts.cap ?? 40;
  const keepTurns = opts.keepTurns ?? 2;
  if (!Array.isArray(messages) || messages.length === 0) return messages ? [...messages] : [];

  // 1) separa os system(s) do topo (prompt principal e quaisquer systems iniciais contíguos).
  let head = 0;
  const lead = [];
  while (head < messages.length && messages[head].role === 'system') { lead.push(messages[head]); head++; }
  const body = messages.slice(head);

  // 2) agrupa o corpo em TURNOS — cada turno começa num role:'user'. Mensagens antes do 1º
  //    user (caso raro de turno anterior que estourou as 8 iterações sem resposta final)
  //    formam um grupo próprio, tratado como o turno mais antigo.
  const turns = [];
  let cur = null;
  for (const m of body) {
    if (m.role === 'user' || !cur) { cur = []; turns.push(cur); }
    cur.push(m);
  }

  // 3) reescreve cada turno: remove nudges consumidos; stub de resultado de tool antigo.
  const T = turns.length;
  const rewritten = turns.map((turn, ti) => {
    const recent = ti >= T - keepTurns; // últimos keepTurns turnos: tool verbatim
    const out = [];
    for (const m of turn) {
      if (isNudge(m)) continue;
      if (!recent && m.role === 'tool' && !EXEMPT_TOOLS.has(m.name)) {
        out.push({ ...m, content: stubDe(m.name) }); // preserva role/tool_call_id/name → pairing intacto
      } else {
        out.push(m);
      }
    }
    return out;
  });

  // 4) CAP: dropa TURNOS inteiros mais antigos até caber (nunca quebra par tool_calls↔tool,
  //    nunca dropa o turno mais recente).
  let kept = rewritten;
  const total = () => lead.length + kept.reduce((n, t) => n + t.length, 0);
  while (kept.length > 1 && total() > cap) kept = kept.slice(1);

  return [...lead, ...kept.flat()];
}
