// dossie.mjs — as "4 fotos seguidas". O morador manda o contrato uma página por vez.
//
// Onde o binário mora: store EFÊMERO em memória do processo, chaveado pelo morador — o mesmo padrão do
// store token->PDF da CND (cnd.mjs). ⚠️ NUNCA na sessão Redis: a sessão é serializada inteira a cada
// turno, e 4 fotos × 3 MB em base64 virariam ~16 MB de JSON indo e voltando do Redis a cada mensagem.
// A sessão continua com texto; o binário fica aqui e morre sozinho.
//
// Por que não um timer para agrupar as fotos: com foto o intervalo é humano (10–60s, a pessoa
// fotografando página por página). Timer curto corta o dossiê no meio; timer longo atrasa TODO anexo do
// sistema. Quem fecha o dossiê é a conversa — a Ana pergunta "é só isso ou tem mais alguma página?" —
// e o próprio laudo é a rede de segurança: se analisar cedo, ele devolve "faltou a assinatura/página".
//
// Perder o dossiê num redeploy é aceitável: a Fase 0 é informativa, nada trava, o morador reenvia.

import crypto from 'node:crypto';

const TTL_MS = parseInt(process.env.DOCIA_DOSSIE_TTL_MS || String(30 * 60 * 1000), 10); // 30min
const MAX_PECAS = parseInt(process.env.DOCIA_DOSSIE_MAX || '10', 10);
const MAX_BYTES_TOTAL = parseInt(process.env.DOCIA_DOSSIE_MAX_BYTES || String(40 * 1024 * 1024), 10);

// chave (morador) -> { pecas: [{id, mime, buf, nome, em}], expira }
const store = new Map();

function gc(agora = Date.now()) {
  for (const [k, v] of store) if (v.expira < agora) store.delete(k);
}

/** Guarda uma página do dossiê. Teto duro por morador — store em memória não pode virar vazamento. */
export function adicionarPeca(chave, { mime, buf, nome } = {}, agora = Date.now()) {
  if (!chave || !buf?.length) return { ok: false, motivo: 'formato' };
  gc(agora);
  const atual = store.get(chave);
  const pecas = atual && atual.expira >= agora ? atual.pecas : [];
  if (pecas.length >= MAX_PECAS) return { ok: false, motivo: 'muitas_pecas', total: pecas.length };
  const bytes = pecas.reduce((s, p) => s + p.buf.length, 0) + buf.length;
  if (bytes > MAX_BYTES_TOTAL) return { ok: false, motivo: 'muito_grande', bytes };
  const peca = { id: crypto.randomBytes(8).toString('hex'), mime, buf, nome: nome || null, em: agora };
  pecas.push(peca);
  store.set(chave, { pecas, expira: agora + TTL_MS }); // cada página nova renova a janela
  return { ok: true, id: peca.id, total: pecas.length };
}

/** As páginas acumuladas, na ordem em que chegaram (página 1 primeiro). */
export function pecasDe(chave, agora = Date.now()) {
  gc(agora);
  const v = store.get(chave);
  return v && v.expira >= agora ? v.pecas.slice() : [];
}

/** Esvazia o dossiê. Chamado LOGO APÓS analisar: sem isto a página de um contrato antigo entra na
 *  análise do próximo (a sessão do morador vive 120min) e o laudo mistura dois documentos — calado. */
export function limpar(chave) {
  store.delete(chave);
}

export const _store = store; // só para teste
