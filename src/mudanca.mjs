// mudanca.mjs — consulta a REGRA DE MUDANÇA do condomínio do morador (READ-ONLY, dado estático).
// Alimenta o alvo A (agendamento de mudança): horário permitido, sábado, 1 mudança/dia, antecedência.
// Fonte: data/mudanca/horarios-mudanca.json (extraído do "Horários de Mudança dos Condomínios" — Fernando 15/06/2026).
// Isolamento: SEMPRE filtra por um único condomínio (a regra de um condo nunca vaza para outro). Mesma filosofia do regimento.mjs.
// Anti-alucinação: se o condomínio não está na base, retorna encontrou:false (a Ana confirma com a equipe) — NUNCA inventa horário.
//
// ⚠️ PRIVACIDADE OPERACIONAL (Fernando 28/06/2026): o JSON mistura, no mesmo texto, REGRA DO MORADOR (horário, antecedência,
// 1 por dia) com PROCEDIMENTO INTERNO DO ADM ("enviar a autorização para a zeladora/portaria no WhatsApp", "cadastrar no
// Shielder", "avisar o síndico"...). O morador NÃO aciona portaria/zeladoria — quem comunica esses canais é a própria NCS.
// Por isso NUNCA devolvemos o campo `procedimento` cru ao modelo: sanitizamos o horário (corta no 1º marcador interno) e
// extraímos só as regras do morador. Antes, a Ana repassava "fale com a zeladora/portaria" ao morador (errado).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'data', 'mudanca', 'horarios-mudanca.json');

const norm = (s) => (s || '')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// Regras GERAIS de mudança (valem para todos os condomínios — confirmadas pelo Fernando 15/06/2026).
// Antecedência elevada de 24h → 72h (Fernando 28/06): "melhor pedir um tempo a mais que pecar pelo a menos"
// (subpromessa / cliente mais feliz). O prazo ESPECÍFICO de cada condo (1-2 dias) ainda aparece em regras_condominio.
const REGRAS_GERAIS = {
  taxa: 'A mudança não tem taxa.',
  antecedencia: 'Recomendamos solicitar com pelo menos 72 horas (3 dias) de antecedência — assim dá tempo de conferir e liberar com tranquilidade.',
  como_agendar: 'Pelo formulário de mudança (disponível 24h por dia no site) ou com um atendente (seg a sex, 8h às 17h45).',
  confirmacao: 'É preciso aguardar a confirmação do agendamento — a administração (NCS) confere e envia o termo de autorização.',
  quem_comunica: 'Quem comunica a portaria, a zeladoria e faz o cadastro nos sistemas é a própria administração (NCS). O morador NÃO precisa contatar esses canais — basta preencher o formulário e aguardar a autorização.',
};

// Marcadores de PROCEDIMENTO INTERNO DO ADM: a partir do 1º match, o texto deixa de ser regra do morador e vira
// instrução interna (avisar portaria/zeladoria, cadastrar em sistema, mandar e-mail/WhatsApp). Tudo isso é cortado.
// Cuidado: "ZELADOR" sozinho pode ser benigno ("pausa para o almoço do zelador") → só corta em FRASE DE AÇÃO.
const INTERNO_RE = /\b(enviar|cadastr\w*|mandar|encaminhar|comunicar|avisar\s+(a|o|à|da|do)\s+s[ií]ndic\w*|avisar\s+da\s+s[ií]ndica|confirmar\s+com|grupo\s+(do|de)\s+whats|whats\s*app\s+da\s+portaria|no\s+whats|e-?mail|informativo|alarm\s+system|portaria\s+cadastra|agendar\s+(no|na)\s+shielder|cadastro\s+no\s+shielder|registrar\s+no)\b/i;

// Sanitiza o horário: mantém só até o 1º marcador interno; remove parênteses de procedimento; limpa pontas.
function sanitizarHorario(texto) {
  let t = (texto || '').trim();
  if (!t) return '';
  // remove grupos entre parênteses que contenham marcador interno (ex.: "(ENVIAR A AUTORIZAÇÃO PARA A ZELADORA...)")
  t = t.replace(/\(([^)]*)\)/g, (m, inner) => (INTERNO_RE.test(inner) ? ' ' : m));
  const mk = t.match(INTERNO_RE);
  if (mk) t = t.slice(0, mk.index);
  t = t.replace(/\s+/g, ' ').trim();
  // limpa caudas soltas deixadas pelo corte: conjunção "E", fragmento de 1-2 letras, "-MUDANÇA", pontuação/hífen avulsos
  t = t.replace(/[\s.,\-/(]*\bmudan[çc]a\b\s*$/i, '').trim();
  t = t.replace(/[\s.,\-/(]+([a-zà-ú]{1,2})\s*$/i, '').trim();
  t = t.replace(/[\s,\-/(]*(\be\b)?[\s,\-/(]*$/i, '').trim();
  return t;
}

// Extrai as REGRAS DO MORADOR (antecedência, 1 por dia) de horario+procedimento, em frases limpas (sem rota interna).
function regrasMorador(horario, procedimento) {
  const full = `${horario || ''} . ${procedimento || ''}`;
  const out = [];
  const ant = full.match(/(\d+)\s*dias?\s*de\s*anteced/i) || full.match(/entregar\s*com\s*(\d+)\s*dias?/i) || full.match(/avisar\s*com\s*(\d+)\s*dia/i);
  if (ant) { const n = ant[1]; out.push(`Neste condomínio, avisar com no mínimo ${n} ${n === '1' ? 'dia' : 'dias'} de antecedência.`); }
  if (/n[ãa]o\s*liberar\s*2/i.test(full) || /(uma|s[oó]\s*(pode\s*)?(uma|1)|1)\s*mudan[cç]a\s*por\s*dia|mudan[cç]a\s*por\s*dia/i.test(full)) {
    out.push('Apenas uma mudança por dia.');
  }
  if (/n[ãa]o\s*agendar\s*(aos\s*)?feriado/i.test(full)) out.push('Não há mudança em feriados.');
  return out;
}

let _index = null; // { slug: {nome, horario, procedimento, aliases:[norm]} }
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
      horario: c.horario || '',
      procedimento: c.procedimento || '',
      aliases: (c.aliases || []).map(norm).filter(Boolean),
    };
  }
  return _index;
}

// Resolve o condomínio por nome/slug/alias, sem nunca assumir (igual ao regimento). Retorna { slug } ou { slug:null, motivo }.
function resolveCondo(index, condominio) {
  const slugs = Object.keys(index);
  if (!condominio || !norm(condominio)) return { slug: null, motivo: 'condominio_nao_informado' };
  const c = norm(condominio);
  if (index[c]) return { slug: c };
  // 1) match EXATO por nome OU alias (prioridade — evita colisão por substring, ex.: "Studio 5" → "FIVE")
  const exato = slugs.filter((s) => norm(index[s].nome) === c || index[s].aliases.includes(c));
  if (exato.length === 1) return { slug: exato[0] };
  if (exato.length > 1) return { slug: null, motivo: 'condominio_ambiguo', candidatos: exato.map((s) => index[s].nome) };
  // 2) match por inclusão (nome contém / é contido), também considerando aliases
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
  return { slug: null, motivo: 'condominio_sem_regra' };
}

/**
 * consultar_regra_mudanca({ condominio })
 * Retorna a regra de mudança DO CONDOMÍNIO informado, com conteúdo SEGURO PARA O MORADOR:
 *   - horario: faixa de horário permitida (sanitizada — sem rota interna de portaria/zeladoria);
 *   - regras_condominio: antecedência específica e "1 por dia", quando houver;
 *   - regras_gerais: sem taxa, antecedência recomendada (72h), como agendar, quem comunica a portaria (a NCS).
 * NUNCA devolve o procedimento interno (avisar zeladora/portaria, cadastrar em sistema) — isso é da administração, não do morador.
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
    horario: sanitizarHorario(c.horario),
    regras_condominio: regrasMorador(c.horario, c.procedimento),
    regras_gerais: REGRAS_GERAIS,
  };
}

// exporta os helpers p/ teste determinístico (garantir zero vazamento interno).
export { sanitizarHorario, regrasMorador, INTERNO_RE };
