// cobranca.mjs — quem trata a COBRANÇA (boleto +30d / renegociação) de cada condomínio.
// Ordem de roteamento (decidida com Fernando 17/06): garantidora? -> escritório responsável -> gerência da carteira.
// Isolado e anti-alucinação (mesmo padrão de garantidora.mjs / mudanca.mjs): NUNCA inventa escritório nem contato.
// NÃO faz o handoff físico — só RESOLVE o destino + monta o sinal/tag que o componente do fluxo do Octadesk consome.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { consultar_garantidora } from './garantidora.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'escritorios-cobranca.json'), 'utf8'));

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// _matchEscritorio: PURA/testável. Casa por id (preferido) ou, sem id, por nome (superlógica/planilha).
export function _matchEscritorio({ id_condominio, nome } = {}, db = DB) {
  const idn = id_condominio != null && id_condominio !== '' ? String(id_condominio) : null;
  if (idn) {
    const byId = db.condominios.find((c) => c.id != null && String(c.id) === idn);
    if (byId) return byId;
  }
  const nomeN = norm(nome);
  if (nomeN) {
    const byNome = db.condominios.find((c) => {
      const a = norm(c.nome_superlogica), b = norm(c.nome_planilha);
      return (a && (a.includes(nomeN) || nomeN.includes(a))) || (b && (b.includes(nomeN) || nomeN.includes(b)));
    });
    if (byNome) return byNome;
  }
  return null;
}

function contato(nomeEscritorio) {
  if (!nomeEscritorio) return null;
  const e = DB.escritorios[nomeEscritorio] || {};
  return { nome: nomeEscritorio, whatsapp: e.whatsapp || null, email: e.email || null };
}

// escritorioDe: { tem, condominio, extrajudicial:{nome,whatsapp,email}, judicial:{...}|null } ou { tem:false }.
export function escritorioDe({ id_condominio, nome } = {}) {
  const c = _matchEscritorio({ id_condominio, nome });
  if (!c) return { tem: false };
  return {
    tem: true,
    condominio: c.nome_superlogica,
    extrajudicial: contato(c.extrajudicial),
    judicial: c.judicial ? contato(c.judicial) : null,
  };
}

// roteamentoCobranca: para um caso de cobrança/+30d, QUEM trata. Ordem: garantidora -> escritório -> gerência.
// (Garantidora total E allure vão à garantidora nesse contexto: na allure o boleto normal a NCS gera, mas a
//  inadimplência/+30d e o judicial são da garantidora — memória garantidoras-condominios.)
export function roteamentoCobranca({ id_condominio, nome } = {}) {
  const g = consultar_garantidora({ id_condominio, nome });
  if (g.tem) return { destino: 'garantidora', tipo_garantidora: g.tipo, garantidora: g.garantidora, condominio: g.condominio };
  const e = escritorioDe({ id_condominio, nome });
  if (e.tem) return { destino: 'escritorio', condominio: e.condominio, extrajudicial: e.extrajudicial, judicial: e.judicial };
  return { destino: 'gerencia' };
}

const MOTIVOS_COBRANCA = new Set(['cobranca', 'boleto_mais_30_dias', 'renegociacao']);

// sinalCobranca: o que vai no handoff quando o motivo é de cobrança. null se NÃO for cobrança (não enriquece à toa).
// Retorna { tag, roteamento } — a tag é determinística p/ o componente de transferência do Octadesk rotear.
export function sinalCobranca(motivo, { id_condominio, nome } = {}) {
  if (!MOTIVOS_COBRANCA.has(motivo)) return null;
  const r = roteamentoCobranca({ id_condominio, nome });
  const alvo = r.destino === 'escritorio' ? r.extrajudicial?.nome : r.destino === 'garantidora' ? r.garantidora?.nome : 'gerencia';
  const slug = norm(alvo).replace(/\s+/g, '-') || 'gerencia';
  return { tag: `cobranca-${slug}`, roteamento: r };
}
