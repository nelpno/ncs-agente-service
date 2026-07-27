/**
 * link_guard.mjs — cinto de segurança da REGRA Nº 1 para links `gruponcs.net/...`.
 *
 * O prompt já proíbe compor URL (system-prompt.md, "Nunca componha/adivinhe uma URL") e o gate já
 * tem o detector HALLUC_LINK (test/stress-amarelo.mjs). Mesmo assim, em 27/07 a Ana enviou
 * `gruponcs.net/ticket-mudanca` a uma moradora (conv 257) — slug que não existe: o correto é
 * `autorizacao-de-mudanca`. Foi 1 em ~50 links do dia, exatamente o tipo de escorregão que um
 * prompt não elimina e um teste amostral não pega.
 *
 * Aqui a checagem é determinística e roda em TODA resposta: link fora da allowlist (os slugs reais
 * lidos de `data/base-geral/`) é REMOVIDO antes de chegar ao morador. Mandar link errado é pior do
 * que não mandar link — a pessoa clica, cai em 404 e perde a confiança no canal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_DIR = path.join(__dirname, '..', 'data', 'base-geral');
const RE_LINK = /gruponcs\.net\/([a-z0-9-]+)/gi;

// Slugs REAIS extraídos da base oficial (mesma fonte que o retriever entrega à Ana).
export function carregarSlugs(dir = BASE_DIR) {
  const set = new Set();
  try {
    for (const fn of fs.readdirSync(dir)) {
      if (!fn.endsWith('.md')) continue;
      const txt = fs.readFileSync(path.join(dir, fn), 'utf8');
      for (const m of txt.matchAll(RE_LINK)) set.add(m[1].toLowerCase());
    }
  } catch { /* base ausente → allowlist vazia = guard desligado (nunca derruba link bom) */ }
  return set;
}

const ALLOW = carregarSlugs();

/**
 * Remove links gruponcs.net que não existem na base.
 * Match EXATO (mais rígido que o do gate, que aceita prefixo): em runtime, deixar passar um link
 * errado custa mais do que remover um certo. `allow` vazio = não mexe em nada.
 * @returns {{ texto: string, removidos: string[] }}
 */
export function sanitizarLinks(reply, allow = ALLOW) {
  const texto = String(reply || '');
  if (!texto || !allow || allow.size === 0) return { texto, removidos: [] };

  const removidos = [];
  for (const m of texto.matchAll(RE_LINK)) {
    const slug = m[1].toLowerCase();
    if (!allow.has(slug) && !removidos.includes(slug)) removidos.push(slug);
  }
  if (!removidos.length) return { texto, removidos: [] };

  const ehRuim = (l) => {
    for (const m of l.matchAll(RE_LINK)) if (removidos.includes(m[1].toLowerCase())) return true;
    return false;
  };
  const linhas = texto.split('\n').filter((l) => !ehRuim(l)); // a URL costuma vir sozinha na linha
  let saida = linhas.join('\n')
    .replace(/https?:\/\/\S*gruponcs\.net\/\S+/gi, (u) => (ehRuim(u) ? '' : u)) // sobrou no meio da frase
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  saida += (saida ? '\n\n' : '') +
    'Não consegui confirmar o link exato desse formulário agora. Se quiser, eu encaminho seu pedido para a equipe.';
  return { texto: saida, removidos };
}
