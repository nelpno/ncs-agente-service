// mudanca.mjs — consulta a REGRA DE MUDANÇA do condomínio do morador (READ-ONLY, dado estático).
// Alimenta o alvo A (agendamento de mudança): horário permitido, sábado, 1 mudança/dia, qual portaria/grupo avisar.
// Fonte: data/mudanca/horarios-mudanca.json (extraído do "Horários de Mudança dos Condomínios" — Fernando 15/06/2026).
// Isolamento: SEMPRE filtra por um único condomínio (a regra de um condo nunca vaza para outro). Mesma filosofia do regimento.mjs.
// Anti-alucinação: se o condomínio não está na base, retorna encontrou:false (a Ana confirma com a equipe) — NUNCA inventa horário.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'data', 'mudanca', 'horarios-mudanca.json');

const norm = (s) => (s || '')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// Regras GERAIS de mudança (valem para todos os condomínios — confirmadas pelo Fernando 15/06/2026).
// O horário/procedimento ESPECÍFICO de cada condomínio vem do JSON.
const REGRAS_GERAIS = {
  taxa: 'A mudança não tem taxa.',
  antecedencia: 'Avisar normalmente com no mínimo 24 horas de antecedência.',
  como_agendar: 'Pelo formulário de solicitação de mudança (24h) ou com um atendente (seg a sex, 8h às 17h45).',
  confirmacao: 'Em ambos os casos é preciso aguardar a confirmação do agendamento — a administração envia um termo de autorização após conferir.',
};

let _index = null; // { slug: {nome, horario, procedimento} }
export function _reloadIndex() { _index = null; }

function loadIndex() {
  if (_index) return _index;
  _index = {};
  if (!fs.existsSync(FILE)) return _index;
  let data;
  try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return _index; }
  for (const c of (data.condominios || [])) {
    const slug = c.slug || norm(c.nome).replace(/\s+/g, '-');
    _index[slug] = { nome: c.nome, horario: c.horario || '', procedimento: c.procedimento || '' };
  }
  return _index;
}

// Resolve o condomínio por nome/slug, sem nunca assumir (igual ao regimento). Retorna { slug } ou { slug:null, motivo }.
function resolveCondo(index, condominio) {
  const slugs = Object.keys(index);
  if (!condominio || !norm(condominio)) return { slug: null, motivo: 'condominio_nao_informado' };
  const c = norm(condominio);
  if (index[c]) return { slug: c };
  // match por nome normalizado (contém / é contido)
  const hit = slugs.filter((s) => {
    const nm = norm(index[s].nome);
    return nm === c || nm.includes(c) || c.includes(nm) || norm(s.replace(/-/g, ' ')).includes(c);
  });
  if (hit.length === 1) return { slug: hit[0] };
  if (hit.length > 1) {
    // desempate: prioriza igualdade exata do nome
    const exact = hit.filter((s) => norm(index[s].nome) === c);
    if (exact.length === 1) return { slug: exact[0] };
    return { slug: null, motivo: 'condominio_ambiguo', candidatos: hit.map((s) => index[s].nome) };
  }
  return { slug: null, motivo: 'condominio_sem_regra' };
}

/**
 * consultar_regra_mudanca({ condominio })
 * Retorna a regra de mudança DO CONDOMÍNIO informado: horário permitido, regras de sábado/uma por dia,
 * e o procedimento (qual portaria/grupo avisar, qual sistema cadastrar). Sempre inclui as regras gerais
 * (sem taxa, 24h de antecedência, como agendar, termo de autorização).
 * Se o condomínio não estiver na base, encontrou:false → a Ana confirma com a equipe (não inventa).
 */
export function consultar_regra_mudanca({ condominio } = {}) {
  const index = loadIndex();
  if (!Object.keys(index).length) return { encontrou: false, motivo: 'base_mudanca_vazia', regras_gerais: REGRAS_GERAIS };
  const { slug, motivo, candidatos } = resolveCondo(index, condominio);
  if (!slug) {
    return {
      encontrou: false,
      motivo, // condominio_nao_informado | condominio_sem_regra | condominio_ambiguo
      condominio_pedido: condominio || null,
      ...(candidatos ? { candidatos } : {}),
      regras_gerais: REGRAS_GERAIS,
    };
  }
  const c = index[slug];
  return {
    encontrou: true,
    condominio: c.nome,
    horario: c.horario,
    procedimento: c.procedimento,
    regras_gerais: REGRAS_GERAIS,
  };
}
