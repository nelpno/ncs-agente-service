// carteira.mjs — responde "o Grupo NCS administra o condomínio X?" (READ-ONLY, dado estático).
//
// Por que existe (medido em 04/08/2026 nas conversas reais): em 30 dias, 54 conversas tocaram no tema e
// pelo menos 6 pessoas perguntaram isso de forma direta. A Ana respondia "não consegui confirmar por aqui
// se o Edifício Residencial Park faz parte da carteira administrada" — e o Park ESTÁ na carteira (o
// L'Harmonie e o Parque dos Trilhos também). Boa parte de quem pergunta está comprando apartamento,
// é imobiliária, ou é outra administradora transferindo um condomínio: é pergunta comercial, e a Ana
// ficava com cara de quem não conhece o próprio negócio.
//
// Fonte: data/carteira/condominios-administrados.json (gerado de .tmp/gen_carteira.py a partir da
// planilha do Fernando). SEM PII de propósito — só o nome. Síndico/telefone/gerente ficam no adapter,
// que é interno; esta tool fala com morador e com gente de fora.
//
// ⚠️ REGRA DE OURO: não achar NÃO é "não administramos". Pode ser grafia diferente, apelido do prédio,
// ou condomínio que entrou depois da última planilha (a carteira muda: SEIVA entrou em 04/08). Afirmar
// "não é nosso" para um cliente real custa o cliente. Por isso `encontrou:false` devolve uma orientação
// para pedir o nome completo / confirmar com a equipe, e NUNCA uma negativa categórica.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _filtrarCondos } from './superlogica.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'data', 'carteira', 'condominios-administrados.json');

let _base = null;
export function _reloadCarteira() { _base = null; }

function loadBase() {
  if (_base) return _base;
  _base = [];
  if (!fs.existsSync(FILE)) return _base;
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    _base = (d.condominios || []).map((c) => ({ nome: String(c.nome || '').trim() })).filter((c) => c.nome);
  } catch { _base = []; }
  return _base;
}

/**
 * consultar_carteira_ncs({ condominio }) → { encontrou, nome, ambiguo, candidatos[], total_carteira, resumo }
 *
 * Usa o MESMO matcher da identificação de unidade (_filtrarCondos): substring em fronteira de palavra →
 * todas as palavras significativas → singular → prefixo. É o que faz "Condomínio Vancouver" achar
 * "CONDOMINIO RESIDENCIAL VANCOUVER" e "Rosas de Ouro" achar "ROSA DE OURO", sem colar
 * "Salto Grande I" em "Salto Grande III".
 */
export function consultar_carteira_ncs({ condominio } = {}) {
  const base = loadBase();
  const total = base.length;
  if (!condominio || !String(condominio).trim()) {
    return {
      encontrou: false, nome: null, ambiguo: false, candidatos: [], total_carteira: total,
      resumo: 'Preciso do nome do condomínio para conferir. Pergunte qual é o condomínio.',
    };
  }
  if (!total) {
    return {
      encontrou: false, nome: null, ambiguo: false, candidatos: [], total_carteira: 0,
      resumo: 'Não consegui consultar a lista de condomínios agora. Ofereça confirmar com a equipe.',
    };
  }

  const achados = _filtrarCondos(base, condominio);
  // _filtrarCondos devolve TUDO quando nenhum degrau casa (busca ampla) → isso aqui é "não achei".
  const naoAchou = achados.length === base.length && base.length > 1;

  if (naoAchou) {
    return {
      encontrou: false, nome: null, ambiguo: false, candidatos: [], total_carteira: total,
      resumo: `Não localizei um condomínio com esse nome na lista da NCS. NÃO afirme que a NCS não administra — `
        + `pode ser o nome escrito de outro jeito ou um condomínio que entrou recentemente. Peça o nome completo `
        + `do condomínio (ou o endereço) e, se ainda assim não bater, ofereça confirmar com a equipe.`,
    };
  }

  if (achados.length === 1) {
    return {
      encontrou: true, nome: achados[0].nome, ambiguo: false, candidatos: [], total_carteira: total,
      resumo: `Sim: ${achados[0].nome} é administrado pelo Grupo NCS.`,
    };
  }

  const nomes = achados.map((c) => c.nome);
  return {
    encontrou: true, nome: null, ambiguo: true, candidatos: nomes, total_carteira: total,
    resumo: `Esse nome serve para ${nomes.length} condomínios da NCS: ${nomes.join(' · ')}. Pergunte qual é.`,
  };
}
