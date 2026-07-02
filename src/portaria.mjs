// portaria.mjs — consulta o SISTEMA DE PORTARIA do condomínio do morador (READ-ONLY, dado estático).
// Responde "qual o app/sistema de portaria do meu condomínio?" — a maioria usa Shielder, mas vários usam
// GatWay, Synnus, Alarm System ou TW Virtua. Saber o sistema CERTO evita orientar pelo Shielder quem não o usa.
// Fonte: data/portaria/sistemas-portaria.json (Sistemas_de_Portaria_Condominios.xlsx — Fernando 19/06/2026).
// Isolamento: SEMPRE filtra por um único condomínio (mesma filosofia de regimento.mjs e mudanca.mjs).
// Anti-alucinação: se o condomínio não está na base, encontrou:false (a Ana confirma com a equipe) — NUNCA inventa o sistema.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'data', 'portaria', 'sistemas-portaria.json');

const norm = (s) => (s || '')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

let _index = null; // { slug: {nome, sistema} }
export function _reloadIndex() { _index = null; }

function loadIndex() {
  if (_index) return _index;
  _index = {};
  if (!fs.existsSync(FILE)) return _index;
  let data;
  try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return _index; }
  for (const c of (data.condominios || [])) {
    const slug = c.slug || norm(c.nome).replace(/\s+/g, '-');
    _index[slug] = { nome: c.nome, sistema: c.sistema || '', tipo_portaria: c.tipo_portaria || '', aliases: Array.isArray(c.aliases) ? c.aliases : [] };
  }
  return _index;
}

// Resolve o condomínio por nome/slug, sem nunca assumir (igual a mudanca.mjs). Retorna { slug } ou { slug:null, motivo }.
function resolveCondo(index, condominio) {
  const slugs = Object.keys(index);
  if (!condominio || !norm(condominio)) return { slug: null, motivo: 'condominio_nao_informado' };
  const c = norm(condominio);
  if (index[c]) return { slug: c };
  const nomesDe = (s) => [index[s].nome, ...(index[s].aliases || [])].map(norm).filter(Boolean);
  // 1) match EXATO por nome/apelido tem prioridade (resolve "Studio 5"→FIVE e evita ambiguidade por substring).
  const exato = slugs.filter((s) => nomesDe(s).includes(c));
  if (exato.length === 1) return { slug: exato[0] };
  if (exato.length > 1) return { slug: null, motivo: 'condominio_ambiguo', candidatos: exato.map((s) => index[s].nome) };
  // 2) fallback por substring (nome/apelido/slug).
  const hit = slugs.filter((s) => nomesDe(s).some((n) => n.includes(c) || c.includes(n)) || norm(s.replace(/-/g, ' ')).includes(c));
  if (hit.length === 1) return { slug: hit[0] };
  if (hit.length > 1) {
    const exact = hit.filter((s) => norm(index[s].nome) === c);
    if (exact.length === 1) return { slug: exact[0] };
    return { slug: null, motivo: 'condominio_ambiguo', candidatos: hit.map((s) => index[s].nome) };
  }
  return { slug: null, motivo: 'condominio_sem_sistema' };
}

// Nota geral de portaria (vale p/ todos): o app de portaria cuida de acesso/visitantes/reservas; o FINANCEIRO é pelo Gruvi.
const NOTA_GERAL = 'O sistema/app (Shielder, GatWay, Synnus, Alarm System, TW Virtua) é a ferramenta de GESTÃO da portaria (controle de acesso, visitantes, reservas) — ele NÃO define se a portaria é humana ou virtual. Se a portaria é humana, virtual ou híbrida está no campo tipo_portaria. A parte financeira (boletos, 2ª via) NÃO é pela portaria — é pelo app Gruvi / Área do Condômino.';

/**
 * consultar_sistema_portaria({ condominio })
 * Retorna o sistema de portaria DO CONDOMÍNIO informado (Shielder, GatWay, Synnus, Alarm System, TW Virtua…).
 * usa_shielder=true habilita a Ana a explicar o app Shielder (FAQ está em consultar_base_geral).
 * sistema_conhecido=false (ex.: "Não Identificado") → a Ana confirma com a equipe/portaria, não orienta às cegas.
 * Se o condomínio não estiver na base, encontrou:false → a Ana confirma com a equipe (não inventa o sistema).
 */
export function consultar_sistema_portaria({ condominio } = {}) {
  const index = loadIndex();
  if (!Object.keys(index).length) return { encontrou: false, motivo: 'base_portaria_vazia', nota_geral: NOTA_GERAL };
  const { slug, motivo, candidatos } = resolveCondo(index, condominio);
  if (!slug) {
    return {
      encontrou: false,
      motivo, // condominio_nao_informado | condominio_sem_sistema | condominio_ambiguo
      condominio_pedido: condominio || null,
      ...(candidatos ? { candidatos } : {}),
      nota_geral: NOTA_GERAL,
    };
  }
  const c = index[slug];
  const nsist = norm(c.sistema);
  const usa_shielder = nsist.includes('shielder');
  const sistema_conhecido = !!nsist && !nsist.includes('nao identificado');
  const ntipo = norm(c.tipo_portaria);
  const tipo_conhecido = !!ntipo; // Humana | Virtual | Híbrida
  return {
    encontrou: true,
    condominio: c.nome,
    sistema: c.sistema,          // app de GESTÃO (Shielder/GatWay/...)
    tipo_portaria: c.tipo_portaria || null, // modelo de operação: Humana | Virtual | Híbrida — INDEPENDENTE do sistema
    tipo_conhecido,
    usa_shielder,
    sistema_conhecido,
    nota_geral: NOTA_GERAL,
  };
}
