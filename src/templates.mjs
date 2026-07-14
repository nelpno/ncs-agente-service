// templates.mjs — texto dos avisos FORA do código (spec Onda 1 §4.5).
// Fernando: o texto "pode mudar conforme regimento/convenção" → hoje era string hardcoded no portaria_dispatch
// (commit+build+deploy por ajuste). Agora vive em data/templates/<evento>-<papel>.md, editável sem tocar código.
// Placeholders {{nome}}/{{unidade}}/{{condominio}}/{{telefone}}/{{papel}} resolvidos por replace simples (sem engine).
// LGPD (spec §6.2, bloqueador aberto): NUNCA incluir {{cpf}}/CPF completo no corpo — base legal p/ mandar CPF
// pra portaria/garantidora ainda não foi confirmada. Se um dia precisar, mascarar (***.***.XXX-XX), nunca o CPF cheio.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const D = path.join(__dirname, '..', 'data', 'templates');

let _cache = new Map();
export function _reload() { _cache = new Map(); }

function lerTemplate(evento, papel) {
  const key = `${evento}-${papel}`;
  if (_cache.has(key)) return _cache.get(key);
  let conteudo = null;
  try { conteudo = fs.readFileSync(path.join(D, `${key}.md`), 'utf8'); } catch { conteudo = null; }
  _cache.set(key, conteudo);
  return conteudo;
}

function aplicarVars(texto, vars = {}) {
  return texto.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, chave) => {
    const v = vars[chave];
    return v === undefined || v === null || v === '' ? '—' : String(v);
  });
}

// Fallback = mesmo texto do corpo() legado do portaria_dispatch.mjs (pré-Onda 1) — nunca quebra o dispatch
// quando o .md correspondente não existe (evento/papel novo ainda sem template escrito).
function fallback({ evento, vars = {} }) {
  const quem = vars.papel === 'dependente' ? 'dependente' : (vars.papel && vars.papel !== '—' ? vars.papel : 'morador');
  const linhas = [
    `NCS — ${evento === 'titularidade' ? 'atualização de titularidade' : 'novo ' + quem} no ${vars.condominio && vars.condominio !== '—' ? vars.condominio : '—'}.`,
    vars.nome && vars.nome !== '—' ? `Nome: ${vars.nome}` : null,
    vars.unidade && vars.unidade !== '—' ? `Unidade: ${vars.unidade}` : null,
    vars.telefone && vars.telefone !== '—' ? `Telefone: ${vars.telefone}` : null,
  ];
  return linhas.filter(Boolean).join('\n');
}

/**
 * renderTemplate({evento, papel, vars}) → string
 * Lê data/templates/<evento>-<papel>.md; resolve {{placeholders}} contra `vars` (ausente → "—").
 * Sem .md correspondente → fallback textual equivalente ao corpo() legado (nunca quebra o dispatch).
 */
export function renderTemplate({ evento = 'cadastro', papel = 'portaria', vars = {} } = {}) {
  const tpl = lerTemplate(evento, papel);
  if (!tpl) return fallback({ evento, vars });
  return aplicarVars(tpl.trimEnd(), vars);
}
