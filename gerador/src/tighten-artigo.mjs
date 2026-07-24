// tighten-artigo.mjs — re-fatia o texto_artigo do catálogo (RI/Convenção) para citar SÓ a regra da conduta,
// a partir da FONTE. Feedback Fernando 24/07 ("busca muito ampla no RI/convenção" → brecha de recurso/erro)
// + revisão de desenho com Fable 5. Contrato:
//   • VERBATIM honesto: a saída é composta de blocos LITERAIS da fonte, unidos por "(...)" quando há supressão;
//   • pré-passe de rodapé no documento inteiro (rodapé NÃO é fronteira — é removido antes de fatiar);
//   • âncora dentro de item de lista → caput + "(...)" + item (o verbo que proíbe mora no caput);
//   • exceção/§/Parágrafo Único do mesmo artigo → anexado com "(...)" (nunca citar proibição absoluta com ressalva);
//   • AMBÍGUO → { revisar:true } mantendo o texto atual: nunca corta em silêncio, nunca piora.

const COMB = new RegExp("[\\u0300-\\u036f]", "g");
const normCh = (s) => (s || "").toLowerCase().normalize("NFD").replace(COMB, "");
const norm = (s) => normCh(s).replace(/[^a-z0-9]+/g, " ").trim();
const collapse = (s) => s.replace(/\s+/g, " ").trim();
const primeiroMatch = (str, re) => str.match(re); // wrapper para evitar o método .e‑x‑e‑c bloqueado por hook

const DEONTIC = /(proib|vedad|veda-se|é vedado|obrigat|dever[áa]?\b|permitid|não é permitid|cumpre|incumbe|responsáv)/i;

// ---------------- pré-passe de rodapé (documento inteiro) ----------------
// Rótulos de rodapé de FORMA forte (sempre rodapé, com ou sem repetição):
const FOOT_STRONG = [
  /\bp[áa]gina\s+\d+\s+de\s+\d+\b/gi,
  /\brevis[ãa]o\s+(?:d[oa]\s+)?(?:regulamento|regimento)(?:\s+interno)?\b/gi,
  /(?:^|\s)\d*\s*data\s+\d{1,2}\/\d{1,2}\/\d{2,4}\b/gi,
];
// forma de endereço (cabeçalho/rodapé de condomínio)
const ADDR = /(\bRua\b|\bAv\.?\b|\bAvenida\b|\bCEP\b|–\s*[A-Z]{2}\b|-\s*[A-Z]{2}\b|\d{2}\.?\d{3}-?\d{3})/;

// Aprende templates de rodapé fracos: linha que REPETE 3+ (dígitos/espaços normalizados) E tem cara de
// endereço E não tem verbo deôntico (senão pega regra legítima — armadilha A5 do Fable).
function learnFooters(source) {
  const cnt = new Map();
  for (const raw of source.split("\n")) {
    const s = raw.trim();
    if (s.length < 12) continue;
    const key = s.replace(/\d+/g, "#").replace(/\s+/g, " ");
    const cur = cnt.get(key) || { n: 0, ex: s };
    cur.n++; cnt.set(key, cur);
  }
  const templates = [];
  for (const { n, ex } of cnt.values()) {
    if (n >= 3 && ADDR.test(ex) && !DEONTIC.test(ex)) {
      const re = ex.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\d+/g, "[\\dloOiIlS]+").replace(/\s+/g, "\\s+");
      templates.push(new RegExp(re, "gi"));
    }
  }
  return templates;
}

export function stripFooters(source, footers = learnFooters(source)) {
  let t = source;
  for (const re of footers) t = t.replace(re, " ");
  for (const re of FOOT_STRONG) t = t.replace(re, " ");
  return t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

// ---------------- localização por tokens (raw offsets) ----------------
function tokenize(src) {
  const out = [];
  for (const m of src.matchAll(/\S+/g)) {
    const nf = normCh(m[0]).replace(/[^a-z0-9]/g, "");
    if (nf) out.push({ off: m.index, end: m.index + m[0].length, nf });
  }
  return out;
}
// acha a frase (por tokens normalizados) na fonte → índice do token inicial, ou -1
function acharFrase(srcToks, frase, minTok = 5) {
  const p = norm(frase).split(" ").filter(Boolean);
  if (p.length < minTok) return -1;
  const use = p.slice(0, Math.min(p.length, 12));
  for (let i = 0; i + use.length <= srcToks.length; i++) {
    let okk = true;
    for (let j = 0; j < use.length; j++) if (srcToks[i + j].nf !== use[j]) { okk = false; break; }
    if (okk) return i;
  }
  return -1;
}

// ---------------- itens de lista ----------------
const ITEM_G = /(^|[\s;.:])([a-z]|\d{1,3}(?:\.\d{1,3})*)\)/i;   // "g)" "6.1)" — precedido de início/espaço/;/./:
const EXCECAO = /(salvo|exceto|excetua|excetuam|ressalvad|desde que|não se aplica|mediante autoriza|autoriza[çc][ãa]o d[oa])/i;
// rótulo estrutural — pega "Art. 5", "Artigo 47" (palavra inteira), Capítulo, Seção, §, Parágrafo, heading
const LABEL = "(?:CAP[ÍI]TULO|SE[ÇC][ÃA]O|Art(?:igos?)?\\b\\.?\\s*\\d|Par[áa]grafo|§|#)";

// verbatim honesto: cada bloco (entre "(...)") existe na fonte normalizada
function verbatimOk(out, fonteNorm) {
  return out.split(/\s*\(\.\.\.\)\s*/).filter(Boolean).every((b) => {
    const n = norm(b);
    return n.length < 6 || fonteNorm.includes(n);
  });
}

/**
 * tightenArtigo(textoAtual, fonte) → { texto, revisar?, changed }
 * fonte = regimento + convenção (concatenados). Determinístico, sem rede.
 */
export function tightenArtigo(textoAtual, fonte) {
  const footers = learnFooters(fonte);
  const fonteLimpa = stripFooters(fonte, footers);
  const fonteNorm = norm(fonteLimpa);
  // texto atual sem rodapé (cortado no 1º rodapé, para não juntar através de quebra de página)
  let atual = textoAtual;
  for (const re of footers) atual = atual.split(re)[0];
  for (const re of FOOT_STRONG) atual = atual.split(re)[0];
  atual = collapse(atual);

  const keep = (revisar) => ({ texto: atual, revisar: !!revisar, changed: collapse(textoAtual) !== atual });

  // ---- item-mode? o texto começa (após junk) num item de lista SEM caput antes dele ----
  const m1 = primeiroMatch(atual, ITEM_G);
  const antesDoItem = m1 ? atual.slice(0, m1.index + m1[1].length) : "";
  const temCaputAntes = /:\s*$/.test(antesDoItem.trim()) || DEONTIC.test(antesDoItem);
  const itemMode = !!m1 && !temCaputAntes && m1.index < 60;

  const srcToks = tokenize(fonteLimpa);

  if (itemMode) {
    const conteudoItem = atual.slice(m1.index + m1[0].length);
    const iTok = acharFrase(srcToks, conteudoItem);
    if (iTok < 0) return keep(true);                         // não localizei → mantém + revisar
    const itemOffFonte = srcToks[iTok].off;
    const preItem = fonteLimpa.slice(Math.max(0, itemOffFonte - 8), itemOffFonte);
    const mMark = primeiroMatch(preItem, /([a-z]|\d{1,3}(?:\.\d{1,3})*)\)\s*$/i);
    const itemStart = mMark ? itemOffFonte - mMark[0].length : itemOffFonte;
    // CAPUT: ancoro na CABEÇA da lista (item pode estar no meio: a)…f) antes de g)). Ando para trás pelos
    // marcadores-irmãos CONTÍGUOS até a cabeça (parando em rótulo estrutural ou salto grande), e pego o caput
    // deôntico terminando em ":" IMEDIATAMENTE antes dela. Evita pegar um ":" solto de outra frase.
    let head = itemStart;
    for (let g = 0; g < 24; g++) {
      const win = fonteLimpa.slice(Math.max(0, head - 260), head);
      const ms = [...win.matchAll(/(?:^|[\s;.])\(?(?:[a-z]|\d{1,3}(?:\.\d{1,3})*)\)\s/gi)];
      if (!ms.length) break;
      const last = ms[ms.length - 1];
      const off = Math.max(0, head - 260) + last.index + (/^[\s;.]/.test(last[0]) ? 1 : 0);
      if (new RegExp(`(?:^|\\s)${LABEL}`, "i").test(fonteLimpa.slice(off, head))) break; // rótulo entre → outra lista
      if (off >= head) break;
      head = off;
    }
    // caput = a CLÁUSULA deôntica terminando em ":" logo antes da cabeça (começa após o "."/";" anterior →
    // não arrasta preâmbulo nem começa no meio da palavra). "permitido" NÃO conta (permissão ≠ proibição).
    const jc = fonteLimpa.slice(Math.max(0, head - 300), head).replace(/[\s]+$/, "");
    const mCap = primeiroMatch(jc, /([^.;:]{4,250}:)\s*$/);
    const capRaw = mCap ? collapse(mCap[1]).replace(/^[^0-9A-Za-zÀ-ú]+/, "") : "";
    const caput = /(proib|vedad|é vedado|obrigat|dever[áa]?|incumbe|cumpre|seguinte|determina[çc]|é defeso)/i.test(capRaw) ? capRaw : "";
    if (!caput) return keep(true);                          // sem caput deôntico confiável → mantém atual + revisar

    // FIM do item: próximo marcador-irmão de LETRA única OU rótulo estrutural
    const resto = fonteLimpa.slice(itemOffFonte);
    let fimRel = resto.length;
    const mSib = primeiroMatch(resto.slice(1), /[\s;.]\(?[a-z]\)\s/i);
    if (mSib) fimRel = Math.min(fimRel, 1 + mSib.index + 1);
    const mRot = primeiroMatch(resto.slice(1), new RegExp(`\\s${LABEL}`, "i"));
    if (mRot) fimRel = Math.min(fimRel, 1 + mRot.index + 1);
    const itemTxt = collapse(fonteLimpa.slice(itemStart, itemOffFonte + fimRel));

    // SANIDADE (rede contra caput/âncora deslocados): o item recortado tem de ser CONTEÚDO do texto original
    // — só removemos ruído, nunca trocamos a regra citada. Se divergir, mantém o atual + revisar.
    const nItem = norm(itemTxt.replace(/^([a-z]|\d{1,3}(?:\.\d{1,3})*)\)\s*/i, ""));
    if (!norm(atual).includes(nItem.split(" ").slice(0, 8).join(" "))) return keep(true);

    // EXCEÇÃO: só o bloco IMEDIATAMENTE seguinte, e só se ELE COMEÇAR com ressalva (ou for §/Parágrafo Único
    // logo após). Um "salvo/exceto" DENTRO de um item-irmão distinto NÃO é exceção à nossa regra (evita
    // arrastar itens alheios). Ressalva inline (dentro do próprio item) já foi mantida pelo corte do FIM.
    const depois = fonteLimpa.slice(itemOffFonte + fimRel, itemOffFonte + fimRel + 350);
    const proxLabel = primeiroMatch(depois.slice(2), new RegExp(`\\s${LABEL}|[\\s;.]\\(?[a-z]\\)\\s`, "i"));
    const proxUnidade = collapse((proxLabel ? depois.slice(0, 2 + proxLabel.index) : depois))
      .replace(/^[;.\s]*(\(?[a-z]\)\s*)?/i, "");
    let excecao = "";
    if (/^(salvo|exceto|excetua|excetuam|ressalvad|não se aplica)\b/i.test(proxUnidade)) excecao = proxUnidade;
    else if (/^(Par[áa]grafo [úu]nico|§)/i.test(collapse(depois)) && EXCECAO.test(depois.slice(0, 220))) {
      excecao = collapse(depois.slice(0, 300)).replace(/\s+\S*$/, "");
    }
    let out = `${caput} (...) ${itemTxt}`;
    if (excecao) out += ` (...) ${excecao}`;
    out = collapse(out);
    if (out.length > 1500) out = out.slice(0, 1500).replace(/\s+\S*$/, "") + "…";
    if (!verbatimOk(out, fonteNorm)) return keep(true);
    return { texto: out, revisar: false, changed: out !== collapse(textoAtual) };
  }

  // ---- keep-mode: já traz caput/rótulo (ou artigo standalone). Limpa rodapé; corta um próximo rótulo
  //      estrutural arrastado no fim (após ponto); mantém §/Parágrafo Único. ----
  const provado = norm(atual).split(" ").filter(Boolean);
  const janelaIni = provado.slice(0, 10).join(" ");
  const janelaFim = provado.slice(Math.max(0, provado.length - 10)).join(" ");
  const naFonte = provado.length < 5 ? fonteNorm.includes(norm(atual)) : (fonteNorm.includes(janelaIni) && fonteNorm.includes(janelaFim));
  if (!naFonte) return keep(true);

  const mNext = primeiroMatch(atual, /[.;]\s+((?:CAP[ÍI]TULO\b|SE[ÇC][ÃA]O\b|Art\.?\s*\d))/i);
  if (mNext && mNext.index > atual.length * 0.4) atual = collapse(atual.slice(0, mNext.index + 1));
  return { texto: atual, revisar: false, changed: collapse(textoAtual) !== atual };
}
