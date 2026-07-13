// taxa.mjs — consulta o que está INCLUSO NA TAXA CONDOMINIAL (gás, água, internet) do condomínio (READ-ONLY, dado estático).
// Fonte: data/taxa/taxa-inclusa.json (extraído de "O que é incluso no condomínio" — Fernando 13/07/2026).
// Isolamento: SEMPRE filtra por um único condomínio (a taxa de um condo nunca vaza para outro). Mesma filosofia do mudanca.mjs/regimento.mjs.
// Anti-alucinação: se o condomínio não está na base, retorna encontrou:false — NUNCA inventa gás/água/internet.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'data', 'taxa', 'taxa-inclusa.json');

const norm = (s) => (s || '')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

let _index = null; // { slug: {nome, gas:{incluso,empresa}, agua:{incluso}, internet:[...], aliases:[norm]} }
export function _reloadIndex() { _index = null; }

function loadIndex() {
  if (_index) return _index;
  _index = {};
  if (!fs.existsSync(FILE)) return _index;
  let data;
  try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return _index; }
  for (const c of (data.condominios || [])) {
    const slug = c.slug || norm(c.nome).replace(/\s+/g, '-');
    _index[slug] = {
      nome: c.nome,
      gas: { incluso: !!(c.gas && c.gas.incluso), empresa: (c.gas && c.gas.empresa) || null },
      agua: { incluso: !!(c.agua && c.agua.incluso) },
      internet: Array.isArray(c.internet) ? c.internet.slice() : [],
      aliases: (c.aliases || []).map(norm).filter(Boolean),
    };
  }
  return _index;
}

// Resolve o condomínio por nome/slug/alias, sem nunca assumir (mesmo critério de mudanca.mjs/regimento.mjs:
// match EXATO por nome/alias tem prioridade sobre substring, evitando colisão entre condos parecidos).
function resolveCondo(index, condominio) {
  const slugs = Object.keys(index);
  if (!condominio || !norm(condominio)) return { slug: null, motivo: 'condominio_nao_informado' };
  const c = norm(condominio);
  if (index[c]) return { slug: c };
  const exato = slugs.filter((s) => norm(index[s].nome) === c || index[s].aliases.includes(c));
  if (exato.length === 1) return { slug: exato[0] };
  if (exato.length > 1) return { slug: null, motivo: 'condominio_ambiguo', candidatos: exato.map((s) => index[s].nome) };
  const hit = slugs.filter((s) => {
    const nm = norm(index[s].nome);
    if (nm === c || nm.includes(c) || c.includes(nm) || norm(s.replace(/-/g, ' ')).includes(c)) return true;
    return index[s].aliases.some((a) => a === c || a.includes(c) || c.includes(a));
  });
  if (hit.length === 1) return { slug: hit[0] };
  if (hit.length > 1) {
    const exact = hit.filter((s) => norm(index[s].nome) === c);
    if (exact.length === 1) return { slug: exact[0] };
    return { slug: null, motivo: 'condominio_ambiguo', candidatos: hit.map((s) => index[s].nome) };
  }
  return { slug: null, motivo: 'condominio_sem_dado_taxa' };
}

// Monta uma frase pronta para o morador, sem citar campos internos (obs/revisar_slug nunca chegam aqui).
function montarResumo(nome, gas, agua, internet) {
  const partes = [];
  partes.push(gas.incluso ? `gás incluso na taxa${gas.empresa ? ` (empresa ${gas.empresa})` : ''}` : 'gás NÃO incluso na taxa');
  partes.push(agua.incluso ? 'água inclusa na taxa' : 'água NÃO inclusa na taxa');
  let resumo = `Em ${nome}: ${partes.join('; ')}.`;
  if (internet.length) {
    resumo += ` Provedores de internet liberados no condomínio: ${internet.join(', ')} (contratação individual do morador — não faz parte da taxa condominial).`;
  }
  return resumo;
}

/**
 * consultar_taxa_condominial({ condominio })
 * Retorna o que está INCLUSO NA TAXA do condomínio informado: gás (e empresa, quando incluso), água e
 * provedores de internet liberados (se houver). Isolado por condomínio — nunca mistura dados de condomínios diferentes.
 * Se o condomínio não estiver na base, encontrou:false → a Ana confirma com a equipe (NUNCA inventa).
 */
export function consultar_taxa_condominial({ condominio } = {}) {
  const index = loadIndex();
  if (!Object.keys(index).length) return { encontrou: false, motivo: 'base_taxa_vazia' };
  const { slug, motivo, candidatos } = resolveCondo(index, condominio);
  if (!slug) {
    return {
      encontrou: false,
      motivo, // condominio_nao_informado | condominio_sem_dado_taxa | condominio_ambiguo
      condominio_pedido: condominio || null,
      ...(candidatos ? { candidatos } : {}),
    };
  }
  const c = index[slug];
  const itens = {
    gas: { incluso: c.gas.incluso, empresa: c.gas.empresa },
    agua: { incluso: c.agua.incluso },
    internet: c.internet.slice(),
  };
  return {
    encontrou: true,
    condominio: c.nome,
    itens,
    resumo: montarResumo(c.nome, itens.gas, itens.agua, itens.internet),
  };
}
