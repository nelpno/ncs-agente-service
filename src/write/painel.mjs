// painel.mjs — HTML do painel de aprovação (sem framework). `render` vem da WriteAction.
export function passcodeOk(fornecido, esperado) { return !!esperado && fornecido === esperado; }

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function renderPainel(draft, k = '') {
  const r = draft.render || { campos: [], diff: [] };
  const linhas = r.campos.map((c) => `<tr><th style="text-align:left;padding:4px 12px 4px 0">${esc(c.label)}</th><td>${esc(c.valor)}</td></tr>`).join('');
  const alerta = draft.conflito?.conflito ? `<p style="background:#fde68a;padding:8px;border-radius:6px">&#9888;&#65039; ${esc(draft.conflito.detalhe || 'possível duplicidade — confira')}</p>` : '';
  const jaResolvido = draft.status !== 'pendente' ? `<p>Status: <b>${esc(draft.status)}</b> (nenhuma ação disponível)</p>` : '';
  const acoes = draft.status === 'pendente' ? `
    <form method="POST" action="/aprovacao/${esc(draft.token)}/aprovar"><input type="hidden" name="k" value="${esc(k)}"><input name="aprovador" placeholder="Seu nome" required><button>Aprovar</button></form>
    <form method="POST" action="/aprovacao/${esc(draft.token)}/rejeitar"><input type="hidden" name="k" value="${esc(k)}"><input name="aprovador" placeholder="Seu nome" required><input name="motivo" placeholder="Motivo"><button>Rejeitar</button></form>` : '';
  return `<!doctype html><meta charset="utf-8"><title>Aprovação — ${esc(draft.acao)}</title>
<body style="font-family:system-ui;max-width:560px;margin:40px auto">
<h2>Aprovar escrita — ${esc(draft.time)}</h2>${alerta}
<table>${linhas}</table><p><small>${esc(r.snapshotResumo || '')}</small></p>
${jaResolvido}${acoes}</body>`;
}
