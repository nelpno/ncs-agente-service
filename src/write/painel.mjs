// painel.mjs — HTML do painel de aprovação (sem framework). `render` vem da WriteAction.
export function passcodeOk(fornecido, esperado) { return !!esperado && fornecido === esperado; }

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// opts.simulacao — vem de vaiSimular(draft.acao) (superlogica_write.mjs), a MESMA regra que o slPut
// usa. Quando ligado, aprovar marca o rascunho como concluído mas NADA é gravado no Superlógica; sem
// este aviso o aprovador sai achando que cadastrou (aconteceu com o Fernando em 05/08/2026).
export function renderPainel(draft, k = '', opts = {}) {
  const r = draft.render || { campos: [], diff: [] };
  const simulacao = opts.simulacao === true
    ? `<p style="background:#fef3c7;border:1px solid #d97706;border-left:5px solid #d97706;padding:12px 14px;border-radius:8px;line-height:1.5">
<b>&#9888;&#65039; MODO TESTE — esta aprovação NÃO grava no Superlógica.</b><br>
O cadastro fica registrado aqui para conferência, mas a unidade <b>não</b> é alterada no sistema.
Enquanto o modo teste estiver ligado, quem cadastra de verdade continua sendo a equipe, no Superlógica.</p>`
    : '';
  const linhas = r.campos.map((c) => `<tr><th style="text-align:left;padding:4px 12px 4px 0">${esc(c.label)}</th><td>${esc(c.valor)}</td></tr>`).join('');
  const alerta = draft.conflito?.conflito ? `<p style="background:#fde68a;padding:8px;border-radius:6px">&#9888;&#65039; ${esc(draft.conflito.detalhe || 'possível duplicidade — confira')}</p>` : '';
  // alertas da AÇÃO = o que o aprovador precisa fazer à mão junto com o OK (ex.: virar o proprietário
  // para "só extras" quando o inquilino assume a cobrança). Fica em vermelho e ACIMA dos botões:
  // se não aparecer na tela, o efeito colateral acontece calado.
  const alertasAcao = (r.alertas || []).map((a) =>
    `<p style="background:#fecaca;padding:8px;border-radius:6px;border-left:4px solid #b91c1c">&#9888;&#65039; <b>Antes de aprovar:</b> ${esc(a)}</p>`).join('');
  const jaResolvido = draft.status !== 'pendente' ? `<p>Status: <b>${esc(draft.status)}</b> (nenhuma ação disponível)</p>` : '';
  const acoes = draft.status === 'pendente' ? `
    <form method="POST" action="/aprovacao/${esc(draft.token)}/aprovar"><input type="hidden" name="k" value="${esc(k)}"><input name="aprovador" placeholder="Seu nome" required><button>Aprovar</button></form>
    <form method="POST" action="/aprovacao/${esc(draft.token)}/rejeitar"><input type="hidden" name="k" value="${esc(k)}"><input name="aprovador" placeholder="Seu nome" required><input name="motivo" placeholder="Motivo"><button>Rejeitar</button></form>` : '';
  return `<!doctype html><meta charset="utf-8"><title>Aprovação — ${esc(draft.acao)}</title>
<body style="font-family:system-ui;max-width:560px;margin:40px auto">
<h2>Aprovar escrita — ${esc(draft.time)}</h2>${simulacao}${alerta}
<table>${linhas}</table><p><small>${esc(r.snapshotResumo || '')}</small></p>${alertasAcao}
${jaResolvido}${acoes}</body>`;
}
