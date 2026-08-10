// match-nome.mjs — casar o nome de condomínio como a equipe DIGITA com o nome como o sistema GRAVA.
// Compartilhado pelo catálogo (gerar-lib.carregarCondominio) e pelo ERP (estagiario/superlogica.resolver_condominio):
// os dois falhavam no mesmo caso e a equipe via "o sistema não tem a base desse condomínio".
//
// Por que tokens e não substring: "Condominio Vancouver" NÃO é substring de "CONDOMINIO RESIDENCIAL
// VANCOUVER" — a palavra do meio atravessa. E por que TODAS as palavras significativas: exigir todas é o
// que mantém "Cedros" ambíguo entre "Cedros do Campo" e "Vistas do Botânico - Cedros" (aí quem decide é a
// pessoa, nunca o programa — essa colisão já quebrou um condomínio em silêncio).

const COMB = new RegExp("[\\u0300-\\u036f]", "g");
// O apóstrofo UNE, não separa: "L'Harmonie" é uma palavra só, e o ERP a grava "LHARMONIE" (colado).
// Tratando-o como pontuação, "L'Harmonie" virava "l harmonie" (dois tokens) e NUNCA casava com o
// token único "lharmonie" — nenhum dos 4 degraus pegava, e o L'Harmonie ficava invisível para
// cobrança, garantidora e carteira. Medido em 10/08/2026 (vídeo do Fernando): "cobrança L'Harmonie"
// respondia "não consta aqui o parâmetro de cobrança", com o condomínio na base o tempo todo.
// Removido ANTES da troca de pontuação por espaço — vale também para D'Angelo, Sant'Ana etc.
// ⚠️ O `\s*` não é enfeite: as nossas próprias bases escrevem o MESMO condomínio de três jeitos —
// "LHARMONIE" (cobrança), "L’ HARMONIE" (regra de mudança, com apóstrofo tipográfico E espaço) e
// "L'Harmonie" (como a equipe digita). Tirar só o apóstrofo faria as três divergirem em duas formas
// e eu consertaria a cobrança quebrando a mudança. Absorvendo o espaço, as três viram "lharmonie".
const APOSTROFO = new RegExp("['\\u2019\\u02bc\\u0060\\u00b4]\\s*", "g");
export const normNome = (s) => String(s || "").toLowerCase().normalize("NFD").replace(COMB, "")
  .replace(APOSTROFO, "").replace(/[^a-z0-9]+/g, " ").trim();

// palavras que só dizem o TIPO da pessoa jurídica — aparecem em quase todo nome e não identificam nada.
// "residencial" entra porque o sistema grava "CONDOMINIO RESIDENCIAL VANCOUVER" e a equipe escreve
// "Condomínio Vancouver"; quando o nome é SÓ "Residencial Park", o token do nome próprio ("park") resolve.
const ESTRUTURAL = new Set([
  "condominio", "condominios", "cond", "residencial", "resid", "res", "edificio", "edif", "ed",
  "associacao", "assoc", "asso", "loteamento", "lot", "fechado", "jardim", "jd", "moradores",
  "de", "do", "da", "dos", "das", "e", "em", "predio", "conjunto",
]);

/** tokensNome("Condomínio Residencial Vancouver") → ["vancouver"] */
export function tokensNome(s) {
  return normNome(s).split(" ").filter((t) => t && !ESTRUTURAL.has(t));
}

/** casaPorTokens(["vancouver"], ["CONDOMINIO RESIDENCIAL VANCOUVER", "vancouver"]) → true */
export function casaPorTokens(alvoToks, chaves) {
  if (!alvoToks || !alvoToks.length) return false;                 // só palavra estrutural não identifica
  const disponiveis = new Set((chaves || []).filter(Boolean).flatMap((k) => tokensNome(k)));
  return alvoToks.every((t) => disponiveis.has(t));
}
