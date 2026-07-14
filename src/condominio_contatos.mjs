// condominio_contatos.mjs — resolve os contatos (síndico/portaria/"pessoa") de UM condomínio,
// AGNÓSTICO à fonte (spec Onda 1 §4.2): "dou o condo, recebo os destinos" — não importa se veio do
// Supabase (condominio_contatos, dcirzddyoctxugfowvob) ou do JSON local (piloto/offline/teste).
// Fonte: Supabase quando sbEnabled(); senão data/portaria/condominio_contatos.json (formato {condominios:{slug:{...}}}).
// Nunca lança: erro no Supabase cai pro JSON local (nada falha calado); sem linha conhecida → null.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sbEnabled as _sbEnabled, sbSelect as _sbSelect } from './db_ncs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const P_CONTATOS = path.join(__dirname, '..', 'data', 'portaria', 'condominio_contatos.json');

const CAMPOS = [
  'sindico_nome', 'sindico_whatsapp',
  'portaria_grupo_jid', 'portaria_email',
  'pessoa_nome', 'pessoa_whatsapp', 'pessoa_email',
];

let _jsonCache = null;
export function _reload() { _jsonCache = null; }

function lerJsonPadrao() {
  if (!_jsonCache) {
    try { _jsonCache = JSON.parse(fs.readFileSync(P_CONTATOS, 'utf8')).condominios || {}; }
    catch { _jsonCache = {}; }
  }
  return _jsonCache;
}

function normalizarRow(row) {
  if (!row) return null;
  const out = {};
  for (const c of CAMPOS) out[c] = row[c] ?? null;
  return out;
}

/**
 * resolverContatos(slug, deps?) → {sindico_nome, sindico_whatsapp, portaria_grupo_jid, portaria_email,
 *   pessoa_nome, pessoa_whatsapp, pessoa_email} | null
 * deps opcional (teste/override): { sbEnabled, sbSelect, jsonData } — default = db_ncs.mjs real + JSON em disco.
 * `jsonData` (objeto {slug:{...}}) substitui a leitura do arquivo — útil pra teste sem mexer no JSON de produção.
 */
export async function resolverContatos(slug, deps = {}) {
  if (!slug) return null;
  const sbEnabled = deps.sbEnabled || _sbEnabled;
  const sbSelect = deps.sbSelect || _sbSelect;
  const jsonSource = deps.jsonData || lerJsonPadrao();

  if (sbEnabled()) {
    try {
      const rows = await sbSelect('condominio_contatos', `condominio_id=eq.${encodeURIComponent(slug)}&limit=1`);
      return normalizarRow(rows && rows[0]);
    } catch (e) {
      console.warn('[condominio_contatos] sbSelect falhou, caindo pro JSON local:', e.message);
      // segue pro fallback abaixo — nunca lança
    }
  }
  return normalizarRow(jsonSource[slug]);
}
