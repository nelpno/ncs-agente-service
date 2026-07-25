// fundamento.mjs — lê o campo `fundamento` do catálogo (a base legal que o documento JÁ cita) e localiza
// na fonte o ARTIGO e, quando informado, o ITEM que ele nomeia.
//
// Por que isso existe: o `fundamento` é a única fonte determinística de "qual regra é esta infração" —
// foi escrito na extração e é o que sai impresso no documento ("Considerando o que dispõe o ARTIGO 14°: i)").
// Quando o texto_artigo guardado discorda dele, o documento fica internamente incoerente: cita o item i) e
// imprime o item c) (caso real do barulho do Vancouver, que fazia a multa não sair). Alinhar o texto ao
// fundamento é correção, não adivinhação — nada aqui usa palavra-chave para escolher regra.
//
// Formatos reais no corpus (623 infrações, 52 condomínios):
//   "ARTIGO 14°: i)" · "Regimento Interno, Parágrafo 6º, f)" · "Artigo 4° - Parágrafo Segundo, item e)"
//   "12.6" · "ARTIGO 51° - A)= DAS PROIBIÇÕES AOS CONDÔMINOS: 4)" · "Art. 8° - I" · "Capítulo VIII - Do
//   Horário Art. 3º" · "XVI – DO LIXO / Parágrafo 17º, II" · "§1° Fica expressamente proibido…" · "Art. 22°"

const COMB = new RegExp("[\\u0300-\\u036f]", "g");
const collapse = (s) => String(s || "").replace(/\s+/g, " ").trim();
const semAcento = (s) => String(s || "").normalize("NFD").replace(COMB, "");

// "Art. 14°" / "ARTIGO 51" / "Parágrafo 20º" / "§ 4º" / "10.2." → como localizar o cabeçalho na fonte
const RE_ART = /(?:^|[\s\-–/,:])((?:ARTIGOS?|Art(?:igos?)?\.?)\s*\d{1,3}|(?:PAR[ÁA]GRAFO|Par[áa]grafo|§)\s*\d{1,3}|\d{1,2}\.\d{1,2})\s*[º°oa]?/gi;
// marcador do ITEM, sempre no FIM do fundamento (é o último nível da referência)
const RE_ITEM = [
  { re: /(?:al[íi]nea|item|letra)?\s*\b([a-z])\)\s*$/i, tipo: "letra" },
  { re: /\b(\d{1,2}\.\d{1,2})\s*\.?\s*$/, tipo: "dec" },
  { re: /(?:^|[\s:,\-–])(\d{1,3})\)\s*$/, tipo: "num" },
  { re: /(?:^|[\s:,\-–])([IVX]{1,4})\s*$/, tipo: "romano" },
  { re: /\bitem\s+(\d{1,3})\s*$/i, tipo: "num" },
];

/**
 * parseFundamento("ARTIGO 14°: i)") → { artigo: "ARTIGO 14", item: "i", tipoItem: "letra" }
 * O ARTIGO é a ÚLTIMA referência estrutural citada (em "Capítulo VIII - Do Horário Art. 3º" o que localiza
 * o texto é o "Art. 3º"; o capítulo é só contexto).
 */
export function parseFundamento(fundamento) {
  const fd = collapse(fundamento);
  if (!fd) return { artigo: null, item: null, tipoItem: null };
  let item = null, tipoItem = null;
  for (const { re, tipo } of RE_ITEM) {
    const m = fd.match(re);
    if (m) { item = m[1]; tipoItem = tipo; break; }
  }
  // o trecho onde procurar o artigo exclui o marcador do item — mas SÓ quando existe item, senão o corte
  // come o número do próprio artigo ("Art. 22°" viraria "Art." e nada parsearia).
  const semItem = !item || tipoItem === "dec" ? fd
    : fd.replace(/[\s:,\-–]*(?:al[íi]nea|item|letra)?\s*\S{1,6}\)?\s*$/i, "");
  const arts = [...(semItem || fd).matchAll(RE_ART)].map((m) => collapse(m[1]));
  const artigo = arts.length ? arts[arts.length - 1] : null;
  // "12.6" sozinho é o ITEM, não o artigo (a seção é o "12")
  if (artigo && tipoItem === "dec" && collapse(artigo) === collapse(item)) return { artigo: null, item, tipoItem };
  return { artigo, item, tipoItem };
}

/** regex que acha o cabeçalho do artigo na fonte, tolerando "Art.14º"/"ARTIGO 14 °"/quebra de linha */
function reCabecalho(artigo) {
  const a = semAcento(artigo);
  const mNum = a.match(/(\d{1,3}(?:\.\d{1,3})?)/);
  if (!mNum) return null;
  const num = mNum[1].replace(".", "\\.");
  const tipo = /par|§/i.test(a) ? "(?:PAR[ÁA]GRAFO|Par[áa]grafo|§)" : /art/i.test(a) ? "(?:ARTIGOS?|Art(?:igos?)?)" : null;
  const corpo = tipo ? `${tipo}\\.?\\s*0*${num}` : `0*${num}`;
  return new RegExp(`(?:^|[\\s#*\\-–/,:])${corpo}\\s*[º°oa]?(?![\\d])`, "gi");
}

/**
 * localizarArtigo(fonte, "ARTIGO 14", { item, tipoItem }) → { ini, fim, caput, caputOff } do bloco do artigo
 * (até o próximo cabeçalho estrutural), ou null.
 * ⚠️ O mesmo número de artigo/parágrafo existe NAS DUAS fontes (regimento e convenção são concatenados e
 * repetem a numeração): quando o fundamento diz o item, a ocorrência certa é a que CONTÉM esse item — foi o
 * que fazia o "Parágrafo 6º, k)" do moove cair no parágrafo homônimo da convenção e o item não ser achado.
 * Sem item informado, prefere a ocorrência de caput DEÔNTICO (a que governa uma lista de proibições).
 */
export function localizarArtigo(fonte, artigo, opts = {}) {
  const todos = localizarArtigos(fonte, artigo, opts);
  return todos.escolhido;
}

/**
 * localizarArtigos(fonte, artigo, {item, tipoItem}) → { escolhido, todos[] }
 * TODAS as ocorrências do artigo. Importa porque regimento e convenção repetem a numeração: o "ARTIGO 8º"
 * existe nos dois com conteúdos diferentes, e um cheque de âmbito que só olha a 1ª ocorrência reprova
 * recorte correto (foi o que aconteceu com dom-pedro/animais e park/varanda_varal).
 */
export function localizarArtigos(fonte, artigo, { item = null, tipoItem = null } = {}) {
  const re = reCabecalho(artigo);
  const vazio = { escolhido: null, todos: [] };
  if (!re) return vazio;
  const src = String(fonte || "");
  const alvos = [...src.matchAll(re)];
  if (!alvos.length) return vazio;
  const DEONTICO = /(proib|vedad|é vedado|e vedado|defeso|obriga|dever|deveres|incumbe|cumpre|determina|seguinte|não é permitid|nao e permitid)/i;
  const FIM = /(?:^|\n)[ \t]*#{0,4}[ \t]*\**\s*(?:CAP[ÍI]TULO|SE[ÇC][ÃA]O|(?:ARTIGOS?|Art(?:igos?)?)\.?\s*\d|(?:PAR[ÁA]GRAFO|Par[áa]grafo)\s*\d|§\s*\d)/i;
  const achados = [];
  for (const m of alvos) {
    const ini = m.index + (/^[\s#*\-–/,:]/.test(m[0]) ? 1 : 0);
    const resto = src.slice(ini + m[0].length);
    const mFim = resto.match(FIM);
    const fim = ini + m[0].length + (mFim ? mFim.index : Math.min(resto.length, 8000));
    // caput = do cabeçalho até o 1º ITEM da lista. ⚠️ NÃO cortar no primeiro ":": o formato real é
    // "ARTIGO 14°\n: É vedado aos condôminos: a) …" — parar no ":" logo após o número deixaria o caput sem o
    // verbo que proíbe ("ARTIGO 14° :"), e aí ele é reprovado por falta de polaridade e o alinhamento morre.
    const dentro = src.slice(ini, fim);
    const mItem1 = dentro.match(/(?:^|[\s;.])\(?(?:[a-z]|\d{1,3}(?:\.\d{1,3})*)\)[.\-–=]{0,2}\s/i);
    let cru = dentro.slice(0, mItem1 ? mItem1.index + 1 : Math.min(dentro.length, 400));
    if (cru.length > 400) { const m2 = cru.match(/^([\s\S]{0,400}:)(?=\s)/); cru = m2 ? m2[1] : cru.slice(0, 300); }
    // "ARTIGO 14°\n: É vedado…" → "ARTIGO 14°: É vedado…" (o espaço antes do ":" é da quebra de linha da fonte;
    // sai do texto impresso, e a comparação de verbatim é normalizada, então não afeta a prova)
    const caput = collapse(cru).replace(/\s+:/g, ":").replace(/:\s*:/g, ":");
    achados.push({ ini, fim, caput, caputOff: ini, deontico: DEONTICO.test(caput) });
  }
  let escolhido = null;
  if (item) {
    const temItem = achados.filter((a) => localizarItem(src.slice(a.ini, a.fim), item, tipoItem));
    if (temItem.length) escolhido = temItem.find((a) => a.deontico) || temItem[0];
  }
  if (!escolhido) escolhido = achados.find((a) => a.deontico) || achados[0];
  return { escolhido, todos: achados };
}

/**
 * localizarItem(bloco, item, tipoItem) → { texto, off } do item DENTRO do bloco do artigo, verbatim, ou null.
 * O fim do item é o próximo marcador do MESMO tipo ou um cabeçalho estrutural — nunca engole o vizinho.
 */
export function localizarItem(bloco, item, tipoItem) {
  if (!item) return null;
  const b = String(bloco || "");
  const esc = String(item).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const marcador = tipoItem === "dec" ? `${esc}\\s*[-–]?` : tipoItem === "romano" ? `${esc}\\s*[-–)]` : `\\(?${esc}\\)[.\\-–=]{0,2}`;
  const abre = new RegExp(`(?:^|[\\s;.:])(${marcador})\\s`, "i");
  const m = b.match(abre);
  if (!m) return null;
  const off = m.index + (/^[\s;.:]/.test(m[0]) ? 1 : 0);
  const resto = b.slice(off + m[1].length);
  const irmao = tipoItem === "dec" ? /[\s;.]\d{1,2}\.\d{1,2}\s*[-–]\s/ : tipoItem === "romano" ? /[\s;.][IVX]{1,4}\s*[-–)]\s/ : /[\s;.]\(?[a-z]\)[.\-–=]{0,2}\s/i;
  const mIrmao = resto.match(irmao);
  const mCab = resto.match(/(?:^|\n)[ \t]*#{0,4}[ \t]*\**\s*(?:CAP[ÍI]TULO|SE[ÇC][ÃA]O|(?:ARTIGOS?|Art(?:igos?)?)\.?\s*\d)/i);
  const fimRel = Math.min(mIrmao ? mIrmao.index : Infinity, mCab ? mCab.index : Infinity, resto.length);
  return { texto: collapse(b.slice(off, off + m[1].length + fimRel)), off };
}
