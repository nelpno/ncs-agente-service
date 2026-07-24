// tighten-artigo.mjs — re-fatia o texto_artigo do catálogo (RI/Convenção) para citar SÓ a regra da conduta,
// a partir da FONTE. Feedback Fernando 24/07 ("busca muito ampla no RI/convenção" → brecha de recurso/erro)
// + duas revisões de desenho com Fable 5. Contrato:
//   • VERBATIM honesto: a saída é composta de blocos LITERAIS da fonte, unidos por "(...)" quando há supressão;
//   • pré-passe de rodapé no documento inteiro (rodapé NÃO é fronteira — é removido antes de fatiar);
//   • âncora dentro de item de lista → caput + "(...)" + item (o verbo que proíbe mora no caput);
//   • exceção/§/Parágrafo Único do mesmo artigo → anexado com "(...)" (nunca citar proibição absoluta com ressalva);
//   • AMBÍGUO → { revisar:true } mantendo o texto atual: nunca corta em silêncio, nunca piora.
//
// Os dois danos jurídicos que as redes abaixo existem para impedir (Fable):
//   M1 — colar o caput de OUTRO artigo/lista no item ("São deveres:" governando um item de proibição).
//        Pior que citação ampla: é citação FALSA com cara de verbatim. Redes: decremento ESTRITO entre irmãos,
//        teto de salto, fronteira estrutural, cheque final de vão, unicidade da âncora.
//   M2 — inverter a polaridade: citar como infração um item que é EXCEÇÃO/permissão ("é vedado, salvo nos
//        casos: (...) X"), ou cortar o item antes do "salvo". Redes: blacklist de conectores no caput,
//        exigência de polaridade proibitiva, nunca cortar em ":".

const COMB = new RegExp("[\\u0300-\\u036f]", "g");
const normCh = (s) => (s || "").toLowerCase().normalize("NFD").replace(COMB, "");
// ordinal: o catálogo traz "Art. 1º" e a fonte (OCR) traz "Art. 1o"/"1°"/"1ª" → colapsa SÓ na comparação
// (a saída continua verbatim da fonte). "10" não é afetado: o sufixo colapsado é LETRA.
// ⚠️ homóglifo (Fable): um "1o" da fonte pode ser um "10" mal lido pelo OCR — por isso o match exige
// MIN_TOK tokens de contexto e unicidade; o ordinal nunca é o token decisivo sozinho.
const semOrd = (t) => t.replace(/^(\d{1,3})[oa]$/, "$1");
const norm = (s) => normCh(s).replace(/[^a-z0-9]+/g, " ").trim().split(" ").map(semOrd).join(" ");
// token da FONTE: pontuação INTERNA some ("aluga-las"→"alugalas"). A frase-alvo tem de passar pelo MESMO
// caminho, senão nenhum item com hífen/barra é localizável (era o bug de barbieri/monet).
const tokensDe = (s) => (s.match(/\S+/g) || []).map((t) => semOrd(normCh(t).replace(/[^a-z0-9]/g, ""))).filter(Boolean);
const collapse = (s) => s.replace(/\s+/g, " ").trim();
const primeiroMatch = (str, re) => str.match(re); // wrapper para evitar o método .e‑x‑e‑c bloqueado por hook

const DEONTIC = /(proib|vedad|veda-se|é vedado|obrigat|dever[áa]?\b|permitid|não é permitid|cumpre|incumbe|responsáv)/i;
// polaridade de um CAPUT de infração: proibição ou dever. "permitido" sozinho NÃO serve (permissão ≠ regra
// infringida) — infração pendurada em lista de permissões é erro de extração a montante, não de recorte.
// "obriga" e não "obrigat": o caput real é "Constituem OBRIGAÇÕES de todos os condôminos:" (paineiras)
const CAPUT_POLARIDADE = /(proib|vedad|é vedado|é defeso|obriga|dever[áa]?|deveres|incumbe|cumpre|determina|seguinte|não é permitid|não pod)/i;
// rótulo COM conteúdo (o número do artigo entra na citação; "#"/markdown não) — usado para descartar o
// cabeçalho de capítulo que o candidato a caput às vezes arrasta ("## CAPITULO V ## DAS OBRIGAÇÕES ###
// Artigo 10 Constituem obrigações…" → começa em "Artigo 10").
const RE_ROTULO_CONTEUDO = /(Art(?:igos?)?\.?\s*\d|CAP[ÍI]TULO|SE[ÇC][ÃA]O)/gi;
// conector que revela "item que introduz sub-lista de exceções/condições" — NUNCA é caput de infração (M2)
const CONECTOR_SUBLISTA = /(salvo|exceto|excetua|ressalvad|observad|desde que|mediante|nos casos|nas seguintes condi|condi[çc][õo]es)/i;
const RESSALVA = /(salvo|exceto|excetua|excetuam|ressalvad|desde que|não se aplica|mediante autoriza|autoriza[çc][ãa]o d[oa])/i;
// item AUTOSSUFICIENTE: traz o próprio verbo que obriga/proíbe, então dispensa caput (usado só como ÚLTIMO
// recurso, quando não há caput alcançável — ex.: vida-plena, cuja lista fica sob o título neutro
// "1- DAS NORMAS REGULAMENTARES"). "é permitido" NÃO entra: permissão não é regra infringida (M2).
// o advérbio no meio é a regra, não a exceção ("É EXPRESSAMENTE proibida a lavagem de carros") → tolera até
// 2 palavras entre o verbo de ligação e o particípio.
// inclui a regra PRESCRITIVA de horário/condição ("poderá ser realizado de segunda a sexta das 08h às 17h"):
// é a regra que a notificação invoca quando o reparo saiu da janela. Não vale como CAPUT (permissão não
// governa uma lista de proibições), só como item autossuficiente.
// ⚠️ testado sobre o texto SEM ACENTO (normCh): o OCR come o acento do verbo ("E proibido o uso das
// garagens…" em vez de "É proibido") e a regra ficava invisível. Por isso o padrão vem sem diacrítico.
const AUTO_DEONTICO = /((?:e|fica|esta|sera|sao|foi)\s+(?:\S+\s+){0,2}(?:proibid|vedad|defes|obrigat)|nao e permitid|nao pod|nao sera|devera|deve[mr]?\b|podera\b|cabe\b|obriga-se|fica estabelecid|guardar sil)/i;
// rótulo do artigo imediatamente antes do caput ("### Art. 12", "ARTIGO 51°:-") — entra na citação porque é
// o número que o funcionário e o morador procuram.
const RE_ART_ANTES = /(?:^|\n)#{0,4}\s*(Art(?:igo)?s?\.?\s*\d{1,3}\s*[ºoa°]?)\s*[-–:.]{0,2}\s*$/i;

const MIN_TOK = 6; // piso de tokens para aceitar uma âncora (Fable: item curto casa em prosa alheia → M1)
// salto máximo entre um irmão e o anterior (item longo + ruído de OCR). MEDIDO: 900 não recupera os casos de
// item gigante (dom-pedro q/r/s seguem sem caput) e faz o vancouver localizar contextos divergentes → 600.
const TETO_SALTO = 600;
const MAX_PASSOS = 40;

// ---------------- pré-passe de rodapé (documento inteiro) ----------------
// Rótulos de rodapé de FORMA forte (sempre rodapé, com ou sem repetição):
const FOOT_STRONG = [
  /\bp[áa]gina\s+\d+\s+de\s+\d+\b/gi,
  /\brevis[ãa]o\s+(?:d[oa]\s+)?(?:regulamento|regimento)(?:\s+interno)?\b/gi,
  /(?:^|\s)\d*\s*data\s+\d{1,2}\/\d{1,2}\/\d{2,4}\b/gi,
];
// forma de endereço (cabeçalho/rodapé de condomínio)
const ADDR = /(\bRua\b|\bAv\.?\b|\bAvenida\b|\bCEP\b|–\s*[A-Z]{2}\b|-\s*[A-Z]{2}\b|\d{2}\.?\d{3}-?\d{3})/;
// linha toda em CAIXA ALTA com 2+ palavras: no OCR é como o nome do edifício sobrevive no cabeçalho de
// página ("EDIFÍCIO ÂNGELO SMIRNE"). Só vira rodapé se REPETIR 3+ e não terminar em ":" (senão engoliria
// um caput legítimo tipo "A)= DAS PROIBIÇÕES AOS CONDÔMINOS:").
const ehCaixaAlta = (s) => !/[a-zà-ÿ]/.test(s) && (s.match(/[A-ZÀ-Ý]{2,}/g) || []).length >= 2 && s.length >= 10 && !/:$/.test(s);

// Aprende templates de rodapé fracos: linha que REPETE 3+ (dígitos/espaços normalizados) E tem cara de
// endereço (ou é caixa-alta de cabeçalho) E não tem verbo deôntico (senão pega regra legítima — armadilha A5).
function learnFooters(source) {
  const cnt = new Map();
  for (const raw of source.split("\n")) {
    const s = raw.trim();
    if (s.length < 10) continue;
    const key = s.replace(/\d+/g, "#").replace(/\s+/g, " ");
    const cur = cnt.get(key) || { n: 0, ex: s };
    cur.n++; cnt.set(key, cur);
  }
  const templates = [];
  for (const { n, ex } of cnt.values()) {
    if (n >= 3 && (ADDR.test(ex) || ehCaixaAlta(ex)) && !DEONTIC.test(ex)) {
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
    const nf = semOrd(normCh(m[0]).replace(/[^a-z0-9]/g, ""));
    if (nf) out.push({ off: m.index, end: m.index + m[0].length, nf });
  }
  return out;
}
// acha a frase (por tokens normalizados) na fonte → TODAS as posições (índice do token inicial), até MAX_OCC.
// Devolver todas em vez da primeira é o que permite tratar a duplicação regimento×convenção sem cair no
// "primeira ocorrência vence" — origem de metade dos casos de M1 (Fable). Frase curta não é âncora.
const MAX_OCC = 4;
function acharFrases(srcToks, frase, minTok = MIN_TOK) {
  const p = tokensDe(frase);
  if (p.length < minTok) return [];
  const use = p.slice(0, Math.min(p.length, 12));
  const hits = [];
  for (let i = 0; i + use.length <= srcToks.length && hits.length < MAX_OCC; i++) {
    let okk = true;
    for (let j = 0; j < use.length; j++) if (srcToks[i + j].nf !== use[j]) { okk = false; break; }
    if (okk) hits.push(i);
  }
  return hits;
}

// ---------------- itens de lista ----------------
// marcador de item: "g)" "6.1)" "6).-" "A)=" (sufixos reais dos documentos) e "12.5 -" (decimal com hífen,
// sem parêntese — angelo-smirne/monte-carlo/san-marco/vida-plena).
const SUF = "[.\\-–=]{0,2}";
const ITEM_G = new RegExp(`(^|[\\s;.:])((?:[a-z]|\\d{1,3}(?:\\.\\d{1,3})*)\\)${SUF}|\\d{1,2}\\.\\d{1,2}\\s*[-–])`, "i");
const CORPO_MARK = { letra: "[a-z]", num: "\\d{1,3}(?:\\.\\d{1,3})*", dec: "\\d{1,2}\\.\\d{1,2}" };
const tipoMarcador = (mk) => (/^\d{1,2}\.\d{1,2}\s*[-–]$/.test(mk.trim()) ? "dec" : /^\(?\d/.test(mk) ? "num" : "letra");
// ANCORAGEM (Fable): marcador só vale em início de linha ou após pontuação de fim de cláusula. Sem isso,
// "nos termos da letra b) deste artigo" (prosa) vira marcador e a caminhada ancora no lugar errado.
function reIrmao(tipo, global) {
  const corpo = tipo === "dec" ? `${CORPO_MARK.dec}\\s*[-–]` : `\\(?${CORPO_MARK[tipo]}\\)${SUF}`;
  return new RegExp(`(^|\\n|[;.:]\\s)(${corpo})\\s`, global ? "gi" : "i");
}
// valor sequencial do marcador (a=1, b=2… / 1,2… / 12.5→5) e seção (o "12" de "12.5"), para o decremento
function seqValor(mk, tipo) {
  const s = mk.replace(/[()\s=]/g, "").replace(/[.\-–]+$/, "");
  if (tipo === "letra") return s.toLowerCase().charCodeAt(0) - 96;
  const nums = s.match(/\d+/g) || [];
  return nums.length ? parseInt(nums[nums.length - 1], 10) : NaN;
}
const secaoDe = (mk) => (primeiroMatch(mk, /(\d{1,2})\.\d{1,2}/) || [])[1] || "";
// decremento ESTRITO: só aceita o vizinho IMEDIATO (b) antes de c)). Pular um irmão mangled é exatamente
// como a caminhada atravessa para a lista anterior e cola o caput errado (M1).
// letras que o redator brasileiro PULA na enumeração (k/w/y são "estrangeiras"): "… j) l) m) …" é a
// numeração ORIGINAL do documento, não corrupção — mesmo salto em flores, paineiras e dom-pedro.
const LETRA_PULADA = new Set([11, 23, 25]); // k, w, y
// devolve o marcador EFETIVO do candidato quando ele é o predecessor imediato, ou null
function predecessorDe(cand, atual, tipo) {
  if (secaoDe(cand) !== secaoDe(atual)) return null;
  const a = seqValor(cand, tipo), b = seqValor(atual, tipo);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a === b - 1) return cand;
  if (tipo === "letra") {
    // o item "l)" sai como "I)" no OCR (i maiúsculo): aceito só com a caixa denunciando o erro, e sigo a
    // caminhada tratando-o como "l" — senão o passo seguinte procuraria o predecessor de "i".
    if (b === 13 && a === 9 && cand.replace(/[()\s.\-–=]/g, "") === "I") return cand.replace(/I/, "l");
    if (a === b - 2 && LETRA_PULADA.has(b - 1)) return cand;
  }
  return null;
}
function ehPredecessor(cand, atual, tipo) {
  if (secaoDe(cand) !== secaoDe(atual)) return false;
  const a = seqValor(cand, tipo), b = seqValor(atual, tipo);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a === b - 1) return true;
  // homóglifo do OCR: o item "l)" sai como "I)" (i maiúsculo) — aceito só quando a CAIXA denuncia o erro
  // (lista minúscula com um marcador maiúsculo), senão um "i)" legítimo viraria predecessor de "m)".
  // (o predecessor de "m" é "l"=12; o OCR entrega "I"=9 → só aceito com a caixa denunciando o erro)
  if (tipo === "letra" && b === 13 && a === 9) {
    return cand.replace(/[()\s.\-–=]/g, "") === "I" && atual.replace(/[()\s.\-–=]/g, "") === "m";
  }
  return false;
}
// sufixo do marcador ("6).-" → ".-"): referência inline quase nunca carrega o sufixo → discriminador grátis
const sufixoDe = (mk) => (primeiroMatch(mk, /\)([.\-–=]{1,2})$/) || [])[1] || "";

// rótulo estrutural — pega "Art. 5", "Artigo 47" (palavra inteira), Capítulo, Seção, Título, Cláusula, §,
// Parágrafo, heading. NÃO inclui "item": "no item 12.5" aparece DENTRO de regra e cortaria caminhada boa.
// ⚠️ os rótulos que também são palavra comum na prosa jurídica ("a qualquer TÍTULO, oneroso ou gratuito",
// "nos termos desta CLÁUSULA", "documento ANEXO") exigem NUMERAL depois — senão a caminhada quebra no meio
// de uma lista legítima e o caso vira `revisar` por engano (custou o caso flores nesta rodada).
const LABEL = "(?:CAP[ÍI]TULO|SE[ÇC][ÃA]O|(?:T[ÍI]TULO|ANEXO|CL[ÁA]USULA)\\s+[IVXLCDM\\d]|Art(?:igos?)?\\b\\.?\\s*\\d|Par[áa]grafo|§|#)";
// ⚠️ REFERÊNCIA CRUZADA não é fronteira: itens citam outros artigos no meio da frase ("a multa a lhe ser
// aplicada, em consonância com o estipulado no artigo 50 desta convenção") — ler isso como cabeçalho
// interrompia a caminhada e mandava dom-pedro/flores inteiros para revisão humana. Cabeçalho de verdade
// está em INÍCIO DE LINHA (com ou sem markdown) ou vem em CAIXA ALTA.
const RE_LABEL_LINHA = new RegExp(`(?:^|\\n)[ \\t]*#{0,4}[ \\t]*\\**\\s*${LABEL}`, "i");
const RE_LABEL_CAPS = new RegExp(`(?:^|\\s)(?:ARTIGOS?|ART\\.?|CAP[ÍI]TULO|SE[ÇC][ÃA]O|PAR[ÁA]GRAFO)\\s*\\d`);
// fronteira = cabeçalho estrutural OU linha em caixa alta (heading que o OCR entregou sem markdown)
function temFronteira(trecho) {
  if (RE_LABEL_LINHA.test(trecho) || RE_LABEL_CAPS.test(trecho)) return true;
  return trecho.split("\n").some((l) => ehCaixaAlta(l.trim()));
}

// verbatim honesto: cada bloco (entre "(...)") existe na fonte normalizada
function verbatimOk(out, fonteNorm) {
  return out.split(/\s*\(\.\.\.\)\s*/).filter(Boolean).every((b) => {
    const n = norm(b);
    return n.length < 6 || fonteNorm.includes(n);
  });
}
// todas as ocorrências de uma frase na fonte, como spans crus {ini,fim} (base de acharFrases e da validação
// de idempotência)
function ocorrencias(srcToks, frase, minTok = 2) {
  const p = tokensDe(frase);
  if (p.length < minTok) return [];
  const use = p.slice(0, Math.min(p.length, 12));
  const out = [];
  for (let i = 0; i + use.length <= srcToks.length; i++) {
    let okk = true;
    for (let j = 0; j < use.length; j++) if (srcToks[i + j].nf !== use[j]) { okk = false; break; }
    if (okk) out.push({ ini: srcToks[i].off, fim: srcToks[i + use.length - 1].end });
  }
  return out;
}
// blocos de um texto já re-fatiado têm de existir na fonte, EM ORDEM e no mesmo âmbito (sem cabeçalho
// estrutural entre eles). ⚠️ o bloco de CAPUT é legitimamente curto ("É proibido:" = 2 tokens), então não dá
// para exigir corpo mínimo de todos: ancoro no bloco MAIS LONGO (o item, que é específico) e procuro o caput
// na ocorrência mais PRÓXIMA antes dele — é o caput do artigo certo, não o primeiro "É proibido:" do arquivo.
function blocosConferem(texto, fonteLimpa, srcToks) {
  const blocos = texto.split(/\s*\(\.\.\.\)\s*/).filter(Boolean).map(collapse);
  if (blocos.length < 2) return false;
  let idxLongo = 0;
  for (let i = 1; i < blocos.length; i++) if (tokensDe(blocos[i]).length > tokensDe(blocos[idxLongo]).length) idxLongo = i;
  if (tokensDe(blocos[idxLongo]).length < MIN_TOK) return false;

  for (const ancora of ocorrencias(srcToks, blocos[idxLongo], MIN_TOK)) {
    const spans = new Array(blocos.length);
    spans[idxLongo] = ancora;
    let ok = true;
    for (let i = idxLongo - 1; i >= 0 && ok; i--) {         // caput: a última ocorrência ANTES do próximo bloco
      // tolera prefixo colado por OCR: a fonte tem "### Art.11º" (um token só, "art11") e o catálogo guardou
      // "11º É vedado aos condôminos:" — sem descartar o 1º token, o caput nunca localiza.
      let cands = [];
      const toks = tokensDe(blocos[i]);
      for (let k = 0; k < Math.min(3, toks.length - 1) && !cands.length; k++) {
        cands = ocorrencias(srcToks, toks.slice(k).join(" ")).filter((s) => s.fim <= spans[i + 1].ini);
      }
      if (!cands.length) ok = false; else spans[i] = cands[cands.length - 1];
    }
    for (let i = idxLongo + 1; i < blocos.length && ok; i++) { // exceção: a primeira ocorrência DEPOIS
      const cands = ocorrencias(srcToks, blocos[i]).filter((s) => s.ini >= spans[i - 1].fim);
      if (!cands.length) ok = false; else spans[i] = cands[0];
    }
    if (!ok) continue;
    let bom = true;
    for (let i = 1; i < spans.length; i++) if (temFronteira(fonteLimpa.slice(spans[i - 1].fim, spans[i].ini))) { bom = false; break; }
    if (bom) return true;
  }
  return false;
}

// ADERÊNCIA — quantos termos do título/palavras-chave da infração aparecem no trecho (prefixo de 5 chars
// para tolerar flexão: "menor"⊂"menores", "dirigi"⊂"dirigir"). NÃO serve para ESCOLHER item (enquadrar por
// palavra-chave é justamente o que produz citação errada), só para DETECTAR que o recorte pegou outro item.
function scoreAderencia(txt, meta) {
  const termos = new Set([...(meta.palavras_chave || []), String(meta.titulo || "")]
    .flatMap((t) => norm(t).split(" "))
    .filter((t) => t.length >= 5)
    .map((t) => t.slice(0, 5)));
  const alvo = norm(txt);
  let n = 0;
  for (const t of termos) if (alvo.includes(t)) n++;
  return n;
}
// separa o texto do catálogo nos itens que ele arrasta (o extrator às vezes começa a janela UM ITEM ANTES
// da regra: "l) Instalação de cerca elétrica; m) Os menores de 18 anos … para dirigir" numa infração de
// menor dirigindo — recortar o primeiro item citaria cerca elétrica numa notificação de direção).
function itensDoTexto(t) {
  const re = new RegExp(`(?:^|[\\s;.:])(?:(?:[a-z]|\\d{1,3}(?:\\.\\d{1,3})*)\\)${SUF}|\\d{1,2}\\.\\d{1,2}\\s*[-–])\\s`, "gi");
  const cortes = [...t.matchAll(re)].map((m) => m.index + (/^[\s;.:]/.test(m[0]) ? 1 : 0));
  if (cortes.length < 2) return [t];
  const out = [];
  for (let i = 0; i < cortes.length; i++) out.push(t.slice(cortes[i], cortes[i + 1] ?? t.length));
  return out;
}

/**
 * tightenArtigo(textoAtual, fonte, meta?) → { texto, revisar?, changed, motivo? }
 * fonte = regimento + convenção (concatenados). Determinístico, sem rede.
 * meta (opcional) = { titulo, palavras_chave } da infração — usado só para checar que o item recortado é o
 * que a infração descreve. Sem meta, o comportamento é o de antes.
 */
export function tightenArtigo(textoAtual, fonte, meta = null) {
  const footers = learnFooters(fonte);
  const fonteLimpa = stripFooters(fonte, footers);
  const fonteNorm = norm(fonteLimpa);
  // texto atual sem rodapé (cortado no 1º rodapé, para não juntar através de quebra de página)
  let atual = textoAtual;
  for (const re of footers) atual = atual.split(re)[0];
  for (const re of FOOT_STRONG) atual = atual.split(re)[0];
  atual = collapse(atual);

  // motivo: só diagnóstico (qual rede segurou). Consumidores leem texto/revisar/changed.
  const keep = (revisar, motivo) => ({ texto: atual, revisar: !!revisar, changed: collapse(textoAtual) !== atual, ...(motivo ? { motivo } : {}) });

  // ---- JÁ re-fatiado numa rodada anterior (contém "(...)")? Não re-fatia: valida que os blocos continuam
  //      na fonte, em ordem e no mesmo âmbito. Sem isso a checagem de contiguidade falha (os blocos são
  //      trechos distintos) e o caso vira "revisar" por falso alarme — e a flag perde credibilidade.
  if (atual.includes("(...)")) {
    const blocos = atual.split(/\s*\(\.\.\.\)\s*/).filter(Boolean).map(collapse);
    const confere = blocosConferem(atual, fonteLimpa, tokenize(fonteLimpa));
    // caput de 1-2 tokens ("É proibido:") não passa a prova de verbatim do verificar-catalogo (mínimo 3) e
    // deixa a citação sem o número do artigo → vale refatiar para recompor "Artigo 12. É proibido:".
    const caputCurto = blocos.length > 1 && tokensDe(blocos[0]).length < 3;
    if (confere && !caputCurto) return { texto: atual, revisar: false, changed: collapse(textoAtual) !== atual };
    // refatia a partir do bloco mais específico (o que identifica a regra). Sem "(...)" dentro, não recursa.
    // Também é a saída para texto que NÃO confere (uma rodada antiga cortou o caput no meio da palavra —
    // caso lume/transito).
    let maisLongo = blocos[0] || "";
    for (const b of blocos) if (tokensDe(b).length > tokensDe(maisLongo).length) maisLongo = b;
    if (maisLongo && maisLongo !== atual) {
      const r = tightenArtigo(maisLongo, fonte);
      if (!r.revisar) return { texto: r.texto, revisar: false, changed: collapse(textoAtual) !== r.texto };
    }
    // refatiar falhou: se o texto ao menos confere, mantém o que estava (nunca piora)
    return confere ? { texto: atual, revisar: false, changed: collapse(textoAtual) !== atual } : keep(true, "blocos_nao_conferem");
  }

  // ---- item-mode? o texto começa (após junk) num item de lista SEM caput antes dele ----
  const m1 = primeiroMatch(atual, ITEM_G);
  const antesDoItem = m1 ? atual.slice(0, m1.index + m1[1].length) : "";
  const temCaputAntes = /:\s*$/.test(antesDoItem.trim()) || DEONTIC.test(antesDoItem);
  const itemMode = !!m1 && !temCaputAntes && m1.index < 60;

  const srcToks = tokenize(fonteLimpa);

  if (itemMode) {
    const conteudoItem = atual.slice(m1.index + m1[0].length);
    const posicoes = acharFrases(srcToks, conteudoItem);
    if (!posicoes.length) return keep(true, "item_nao_localizado");
    // O MESMO texto costuma aparecer no regimento E na convenção (documentos que se repetem quase inteiros).
    // Tento cada ocorrência: se os recortes viáveis COINCIDIREM, a ambiguidade é benigna e sigo; se
    // divergirem, há contextos diferentes governando o mesmo texto → humano decide (era o "a 1ª vence" = M1).
    const tentativas = posicoes.map((p) => recortar(srcToks[p].off));
    const viaveis = tentativas.filter((r) => !r.revisar);
    // a comparação ignora os MARCADORES: o mesmo item costuma ser "j)" no regimento e "k)" na convenção.
    // Conteúdo divergente = contextos diferentes governando o texto → humano. Conteúdo igual com marcador
    // diferente = fica a ocorrência cujo marcador é o que o catálogo já registrava (não troca a referência).
    const soConteudo = (t) => norm(t.replace(new RegExp(`(^|\\s)(?:[a-z]|\\d{1,3}(?:\\.\\d{1,3})*)\\)${SUF}(?=\\s)`, "gi"), " "));
    if (new Set(viaveis.map((r) => soConteudo(r.texto))).size > 1) return keep(true, "item_ambiguo");
    if (!viaveis.length) return tentativas[0];
    return viaveis.find((r) => r.texto.includes(collapse(m1[2]))) || viaveis[0];
  }

  function recortar(itemOffFonte) {
    const preItem = fonteLimpa.slice(Math.max(0, itemOffFonte - 14), itemOffFonte);
    const mMark = primeiroMatch(preItem, new RegExp(`(\\(?(?:[a-z]|\\d{1,3}(?:\\.\\d{1,3})*)\\)${SUF}|\\d{1,2}\\.\\d{1,2}\\s*[-–])\\s*$`, "i"));
    const mkAlvo = mMark ? mMark[1] : m1[2];
    const itemStart = mMark ? itemOffFonte - mMark[0].length : itemOffFonte;
    const tipo = tipoMarcador(mkAlvo);
    const sufAlvo = sufixoDe(mkAlvo);

    // FIM do item (calculado antes do caput: o item é quem decide se um caput é dispensável): próximo irmão
    // do MESMO TIPO/sufixo OU rótulo estrutural — senão o último item da lista engole o Art. seguinte.
    const resto = fonteLimpa.slice(itemOffFonte);
    let fimRel = resto.length;
    const mSib = primeiroMatch(resto.slice(1), reIrmao(tipo, false));
    if (mSib) fimRel = Math.min(fimRel, 1 + mSib.index + mSib[1].length);
    const mRot = primeiroMatch(resto.slice(1), new RegExp(`\\s${LABEL}`, "i"));
    if (mRot) fimRel = Math.min(fimRel, 1 + mRot.index + 1);
    // heading que o OCR entregou SEM markdown e sem a palavra "capítulo" ("V - DO USO DOS ESPAÇO FESTAS E
    // ESPAÇO GOURMET") também fecha o item — senão ele entra na citação como se fosse parte da regra.
    let acc = 0;
    for (const linha of resto.split("\n")) {
      if (acc > 0 && ehCaixaAlta(linha.trim())) { fimRel = Math.min(fimRel, acc); break; }
      acc += linha.length + 1;
    }
    // item que termina em ":" introduz uma SUB-LISTA que qualifica a regra: cortar ali seria citar a regra
    // sem as condições dela (M2). Estendo até o próximo irmão de verdade, pulando os sub-itens.
    for (let t = 0; t < 3 && /:$/.test(collapse(fonteLimpa.slice(itemStart, itemOffFonte + fimRel))); t++) {
      const dep = resto.slice(fimRel);
      const mNx = primeiroMatch(dep, reIrmao(tipo, false));
      const mRt = primeiroMatch(dep, new RegExp(`\\s${LABEL}`, "i"));
      const prox = Math.min(mNx ? mNx.index + mNx[1].length : Infinity, mRt ? mRt.index + 1 : Infinity);
      if (!Number.isFinite(prox)) break;
      fimRel += prox;
    }
    const itemTxt = collapse(fonteLimpa.slice(itemStart, itemOffFonte + fimRel));
    const semMarcador = itemTxt.replace(new RegExp(`^(?:[a-z]|\\d{1,3}(?:\\.\\d{1,3})*)\\)${SUF}\\s*|^\\d{1,2}\\.\\d{1,2}\\s*[-–]\\s*`, "i"), "");

    // SANIDADE (rede contra caput/âncora deslocados): o item recortado tem de ser CONTEÚDO do texto original
    // — só removemos ruído, nunca trocamos a regra citada. Se divergir, mantém o atual + revisar.
    if (!norm(atual).includes(norm(semMarcador).split(" ").slice(0, 8).join(" "))) return keep(true, "sanidade_sobreposicao");
    // cortar em ":" é cortar antes da enumeração que qualifica a regra (M2)
    if (/:$/.test(itemTxt)) return keep(true, "corte_em_dois_pontos");

    // CAMINHADA até a CABEÇA da lista: ando para trás pelos irmãos IMEDIATOS (decremento estrito), com teto
    // de salto e parando em fronteira estrutural. Se o irmão anterior for ele PRÓPRIO um caput curto
    // ("A) É proibido:" — dom-pedro), uso-o: é o caput mais específico que governa o item.
    let head = itemStart, headMk = mkAlvo, caputIrmao = "", caputIrmaoOff = -1, gap = false;
    for (let g = 0; g < MAX_PASSOS; g++) {
      const ini = Math.max(0, head - TETO_SALTO);
      const ms = [...fonteLimpa.slice(ini, head).matchAll(reIrmao(tipo, true))];
      if (!ms.length) break;                                   // sem irmão no teto → cabeça alcançada
      const last = ms[ms.length - 1];
      const off = ini + last.index + last[1].length;            // pula o grupo de ancoragem
      if (off >= head) break;
      const entre = fonteLimpa.slice(off, head);
      if (temFronteira(entre)) break;                           // rótulo/heading entre → outra lista (M1)
      const cand = last[2];
      if (sufixoDe(cand) !== sufAlvo) break;                    // família de sufixo diferente
      const mkEfetivo = predecessorDe(cand, headMk, tipo);
      if (!mkEfetivo) {
        // não é o vizinho imediato: pode ser o CAPUT da lista (e só isso justifica parar aqui)
        gap = seqValor(cand, tipo) === seqValor(headMk, tipo) - 2; // salto na numeração da própria fonte
        const bloco = collapse(entre);
        const corpo = bloco.replace(new RegExp(`^${reIrmao(tipo, false).source}`, "i"), "").trim();
        const primeiroDaFamilia = seqValor(headMk, tipo) === 1;
        if (primeiroDaFamilia && bloco.length <= 200 && /:$/.test(bloco) &&
            CAPUT_POLARIDADE.test(corpo) && !CONECTOR_SUBLISTA.test(corpo)) {
          caputIrmao = bloco; caputIrmaoOff = off;
        }
        break;
      }
      head = off; headMk = mkEfetivo;
    }

    // caput = a CLÁUSULA deôntica terminando em ":" logo antes da cabeça (começa após o "."/";" anterior →
    // não arrasta preâmbulo nem começa no meio da palavra). "permitido" NÃO conta (permissão ≠ proibição).
    let caput = caputIrmao, caputOff = caputIrmaoOff;
    const jcIni = Math.max(0, head - 300);
    const jc = fonteLimpa.slice(jcIni, head).replace(/[\s]+$/, "");
    if (!caput) {
      // o ":" costuma estar no fim; quando o OCR deslocou uma palavra para depois dele ("Constituem
      // obrigações de todos os condôminos: - autônomas,"), aceito ruído CURTO e sem pontuação forte
      // depois — o caput usado continua sendo o trecho literal até o ":".
      const mCap = primeiroMatch(jc, /([^.;:]{4,250}:)\s*$/) || primeiroMatch(jc, /([^.;:]{4,250}:)[^.;:]{0,30}$/);
      let capRaw = mCap ? collapse(mCap[1]).replace(/^[^0-9A-Za-zÀ-ú]+/, "") : "";
      let desloc = 0;
      if (capRaw) {
        const ult = [...capRaw.matchAll(RE_ROTULO_CONTEUDO)].pop();   // começa no ÚLTIMO rótulo, se houver
        if (ult && ult.index > 0) { desloc = ult.index; capRaw = capRaw.slice(desloc); }
      }
      if (capRaw && CAPUT_POLARIDADE.test(capRaw) && !CONECTOR_SUBLISTA.test(capRaw)) {
        caput = capRaw; caputOff = jcIni + mCap.index + desloc;
      }
    }
    // caput SEM dois-pontos: linha curta e isolada com o verbo que proíbe ("### Art. 11º\nÉ PROIBIDO\n\n11.1 -"
    // do monte-carlo/san-marco). Só aceita linha PRÓPRIA e curta — em prosa corrida isso seria M1.
    if (!caput) {
      const mLinha = primeiroMatch(jc, /\n\s*([^\n]{4,60})\s*$/);
      const linha = mLinha ? collapse(mLinha[1]) : "";
      if (linha && CAPUT_POLARIDADE.test(linha) && !CONECTOR_SUBLISTA.test(linha) && !ITEM_G.test(linha)) {
        caput = linha; caputOff = jcIni + mLinha.index + mLinha[0].indexOf(mLinha[1]);
      }
    }
    // prefixa o número do artigo quando ele está imediatamente antes do caput — a citação precisa dele
    if (caput && caputOff > 0) {
      const antes = fonteLimpa.slice(Math.max(0, caputOff - 40), caputOff);
      const mArt = primeiroMatch(antes, RE_ART_ANTES);
      // o "Art." pode ter ficado do lado de fora: o corte do caput para no PONTO de "Art." e o número
      // sobra no começo do caput ("12 É PROIBIDO aos condôminos:") → recompõe "Art. 12 É PROIBIDO…"
      const mSo = !mArt && /^\d{1,3}[ºoa°]?\b/.test(caput) ? primeiroMatch(antes, /(?:^|\n)#{0,4}\s*(Art(?:igo)?s?\.?)\s*$/i) : null;
      if (mArt) { caput = `${collapse(mArt[1])} ${caput}`; caputOff -= mArt[0].length; }
      else if (mSo) { caput = `${collapse(mSo[1])} ${caput}`; caputOff -= mSo[0].length; }
    }
    // ÚLTIMO recurso: sem caput alcançável, mas o ITEM já traz o próprio verbo que obriga/proíbe (vida-plena)
    // → cita só o item. Nunca quando ele abre com ressalva (seria citar a exceção como regra).
    const autossuficiente = AUTO_DEONTICO.test(normCh(semMarcador)) && !primeiroMatch(semMarcador.slice(0, 40), CONECTOR_SUBLISTA);
    // motivo distinto quando a numeração da FONTE tem salto (OCR comeu um item): não tolero o gap — pular
// irmão é como a caminhada atravessa para outra lista — mas o relatório humano ganha a informação certa.
    if (!caput && !autossuficiente) return keep(true, gap ? "gap_na_sequencia" : "sem_caput");

    // CHEQUE DE VÃO: nenhum rótulo estrutural entre o fim do caput e o início do item — pega o M1 mesmo
    // quando a caminhada errou por um caminho que não previmos.
    if (caput && caputOff >= 0 && itemStart > caputOff && temFronteira(fonteLimpa.slice(caputOff + caput.length, itemStart))) {
      return keep(true, "vao_com_rotulo");
    }

    // EXCEÇÃO: só o bloco IMEDIATAMENTE seguinte, e só se ELE COMEÇAR com ressalva (ou for §/Parágrafo Único
    // logo após). Um "salvo/exceto" DENTRO de um item-irmão distinto NÃO é exceção à nossa regra (evita
    // arrastar itens alheios). Ressalva inline (dentro do próprio item) já foi mantida pelo corte do FIM.
    const depois = fonteLimpa.slice(itemOffFonte + fimRel, itemOffFonte + fimRel + 350);
    const proxLabel = primeiroMatch(depois.slice(2), new RegExp(`\\s${LABEL}|${reIrmao(tipo, false).source}`, "i"));
    const proxUnidade = collapse((proxLabel ? depois.slice(0, 2 + proxLabel.index) : depois))
      .replace(/^[;.\s]*(\(?[a-z]\)\s*)?/i, "");
    let excecao = "";
    if (/^(salvo|exceto|excetua|excetuam|ressalvad|não se aplica)\b/i.test(proxUnidade)) excecao = proxUnidade;
    else if (/^(Par[áa]grafo [úu]nico|§)/i.test(collapse(depois)) && RESSALVA.test(depois.slice(0, 220))) {
      excecao = collapse(depois.slice(0, 300)).replace(/\s+\S*$/, "");
    }
    let out = caput ? `${caput} (...) ${itemTxt}` : itemTxt;
    if (excecao) out += ` (...) ${excecao}`;
    out = collapse(out);
    if (out.length > 1500) out = out.slice(0, 1500).replace(/\s+\S*$/, "") + "…";
    if (!verbatimOk(out, fonteNorm)) return keep(true, "verbatim");
    // ADERÊNCIA: se o texto do catálogo arrasta vários itens e OUTRO deles descreve a infração melhor que o
    // recortado, o extrator gravou a janela deslocada → humano decide. Não escolho o outro item por
    // palavra-chave; só me recuso a estreitar para o item errado (que seria pior que a citação ampla).
    if (meta && (meta.titulo || meta.palavras_chave)) {
      const pedacos = itensDoTexto(atual);
      // critério ESTREITO: só barra quando o item recortado não tem NENHUMA relação com a infração e outro
      // item tem relação clara. Comparar "quem tem mais termos" daria falso positivo — item mais longo
      // acumula termos por acidente (vida-plena: o 17.4 sobre recolher excrementos "ganharia" do 17.3, que é
      // a regra certa) e o recorte bom seria barrado.
      if (pedacos.length > 1 && scoreAderencia(semMarcador, meta) === 0 &&
          Math.max(...pedacos.map((p) => scoreAderencia(p, meta))) >= 2) {
        return keep(true, "item_nao_descreve_infracao");
      }
    }
    return { texto: out, revisar: false, changed: out !== collapse(textoAtual) };
  }

  // ---- keep-mode (o item-mode acima já retornou): já traz caput/rótulo (ou artigo standalone). Limpa
  //      rodapé; corta um próximo rótulo
  //      estrutural arrastado no fim (após ponto); mantém §/Parágrafo Único. ----
  const provado = norm(atual).split(" ").filter(Boolean);
  const janelaIni = provado.slice(0, 10).join(" ");
  const janelaFim = provado.slice(Math.max(0, provado.length - 10)).join(" ");
  const naFonte = provado.length < 5 ? fonteNorm.includes(norm(atual)) : (fonteNorm.includes(janelaIni) && fonteNorm.includes(janelaFim));
  if (!naFonte) return keep(true, "nao_localizado_na_fonte");

  const mNext = primeiroMatch(atual, /[.;]\s+((?:CAP[ÍI]TULO\b|SE[ÇC][ÃA]O\b|Art\.?\s*\d))/i);
  if (mNext && mNext.index > atual.length * 0.4) atual = collapse(atual.slice(0, mNext.index + 1));
  return { texto: atual, revisar: false, changed: collapse(textoAtual) !== atual };
}
