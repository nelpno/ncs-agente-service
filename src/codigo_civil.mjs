// codigo_civil.mjs — BASE do CÓDIGO CIVIL (condomínio, arts. 1.314–1.358), READ-ONLY, RAG local.
// É a **Pesquisa 2** (decisão do Fernando 23/07): quando a Convenção/Regimento Interno do condomínio NÃO
// cobre a conduta, procura-se o artigo do Código Civil e cita-se a LEI. Mesma mecânica do base_geral.mjs
// (normalização + sinônimos + scoring por seção), mas a base é a LEI (global, não por condomínio) e cada
// chunk é UM ARTIGO (`### Art. 1.XXX — título`). Fonte = planalto.gov.br, texto compilado, VERBATIM.
// Anti-alucinação: nada relevante → { encontrou:false }; NUNCA parafrasear o artigo — o texto vem daqui.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', 'data', 'codigo-civil');

const norm = (s) => (s || '')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const STOP = new Set(('de a o que e do da em um para com nao uma os no se na por mais as dos como mas ao ele das tem seu sua ou ser quando muito ha nos ja esta eu tambem so pelo pela ate isso ela entre era depois sem mesmo aos seus quem nas me esse eles voce essa num nem suas meu minha numa pelos elas qual lhe deles essas esses pra artigo artigos lei codigo civil').split(' '));

// Ponte de VOCABULÁRIO: o que a equipe/relato diz (infiltração, barulho, obra) × o que a LEI escreve
// (prejudicial ao sossego/salubridade/segurança; responde pelo dano; deveres; obras; fachada; contribuição/multa).
const SYN = {
  infiltracao:['dano','danos','prejudicial','salubridade','seguranca','vazamento','umidade','terraco','inferiores','conservacao'],
  vazamento:['infiltracao','dano','danos','prejudicial','salubridade','agua','terraco'],
  dano:['danos','prejudicial','responde','indenizar','perdas','reparar','causou'],
  danos:['dano','prejudicial','responde','perdas','indenizar'],
  indenizar:['dano','danos','perdas','responde','reparar'],
  // "prejuizo" NÃO expande p/ dano: "prejuízo ao sossego" (barulho) é detrimento, não dano material — a
  // expansão fazia o art. de dano (1.319, título "…frutos e danos") roubar o topo do sossego (1.336, IV).
  // Dano real continua coberto por dano/danos/infiltracao/vazamento (que aparecem literalmente no relato).
  barulho:['sossego','prejudicial','ruido','som','perturbar','salubridade','costumes'],
  ruido:['barulho','sossego','prejudicial','som'], som:['barulho','sossego','prejudicial'],
  sossego:['barulho','prejudicial','salubridade','costumes','perturbar'],
  perturbacao:['sossego','prejudicial','barulho','perturbar'], perturbar:['sossego','prejudicial','barulho'],
  vizinho:['possuidores','sossego','salubridade','seguranca','prejudicial'],
  uso:['destinacao','prejudicial','usar','fruir','fim'], destinacao:['uso','fim','prejudicial','edificacao'],
  obra:['obras','reforma','seguranca','edificacao','voluptuarias','uteis','necessarias'],
  obras:['obra','reforma','seguranca','voluptuarias','uteis','necessarias'], reforma:['obra','obras','seguranca'],
  fachada:['forma','cor','esquadrias','externas','alterar'], alterar:['fachada','forma','cor','destinacao'],
  multa:['sancoes','pecuniarias','moratoria','deveres','contribuicao'], // reiteradamente/quintuplo/decuplo → só em reincidencia/reiterado (senão "multa" genérico rouba o art. de reincidência)
  penalidade:['multa','sancoes','pecuniarias','deveres'], sancao:['multa','sancoes','pecuniarias'],
  inadimplencia:['contribuicao','moratorios','juros','pagar','debito','despesas','moratoria'],
  inadimplente:['contribuicao','moratorios','juros','debito','pagar'], debito:['contribuicao','moratorios','juros','pagar'],
  contribuicao:['despesas','fracoes','pagar','moratorios','multa','condominio'],
  cobranca:['contribuicao','moratorios','multa','debito','despesas'], juros:['moratorios','multa','contribuicao'],
  reincidencia:['reiteradamente','antissocial','nocivo','reiterado','gravidade','faltas'],
  antissocial:['nocivo','reiterado','incompatibilidade','convivencia','reiteradamente','anti social'],
  reiterado:['reiteradamente','antissocial','nocivo','reincidencia'],
  garagem:['vaga','abrigo','veiculos','locacao'], vaga:['garagem','abrigo','veiculos'],
  sindico:['administrar','competencias','destituicao','mandato','eleicao'],
  assembleia:['deliberacao','quorum','convocacao','votos','assembleias'],
  fachada_externa:['fachada','esquadrias','externas'], seguranca:['edificacao','prejudicial','obras'],
};

// Fatiamento do ARTIGO por inciso/parágrafo (feedback Fernando 24/07): a notificação citava o Art. 1.336
// INTEIRO (deveres + fachada + juros/débito + multa), afogando a conduta relatada. Um artigo "guarda-tudo"
// vira vários chunks — cada inciso/parágrafo separado — para o retriever devolver SÓ o trecho da conduta
// (barulho → inciso IV; inadimplência → § 1º). O texto continua VERBATIM da base; só muda o recorte.
const reInciso = /^([IVXLC]+)\s+[–—-]\s/;          // "IV – …" (traço = en/em-dash ou hífen)
const rePar = /^(§\s*\d+º?|Par[aá]grafo [uú]nico)/i; // "§ 1º …" | "Parágrafo único …"

function segmentar(secao, lines) {
  const body = lines.filter((l) => !/^▸/.test(l));      // tira notas editoriais "▸ … com redação dada …"
  const one = (sec, txt) => { const t = String(txt).trim(); return t.length > 20 ? [{ secao: sec, texto: t }] : []; };
  const mArt = secao.match(/^\s*(Art\.\s*[\d.]+)/i);
  if (!mArt) return one(secao, body.join(' '));              // não-artigo (Tópicos): 1 chunk, como antes
  const artBase = mArt[1].replace(/\s+/g, ' ').trim();       // "Art. 1.336"

  const bounds = [];
  body.forEach((l, i) => {
    const mi = l.match(reInciso), mp = l.match(rePar);
    if (mi) bounds.push({ i, label: mi[1], inciso: true });
    else if (mp) bounds.push({ i, label: mp[1].replace(/\s+/g, ' ').trim(), inciso: false });
  });
  if (!bounds.length) return one(secao, body.join(' '));      // artigo simples (1.344 etc.): 1 chunk INTEIRO

  const out = [];
  const caput = body.slice(0, bounds[0].i).join(' ').trim();
  const leadIn = /:\s*$/.test(caput);                         // "São deveres do condômino:" = lista → prefixa incisos
  if (caput && !leadIn) out.push(...one(artBase, caput));      // caput é provisão própria (1.337, 1.331) → "Art. 1.XXX"
  for (let b = 0; b < bounds.length; b++) {
    const to = b + 1 < bounds.length ? bounds[b + 1].i : body.length;
    const seg = body.slice(bounds[b].i, to).join(' ').trim();
    const txt = (bounds[b].inciso && leadIn && caput) ? `${caput} ${seg}` : seg; // inciso herda o caput-lista
    out.push(...one(`${artBase}, ${bounds[b].label}`, txt));
  }
  return out;
}

let _index = null;
function loadIndex() {
  if (_index) return _index;
  _index = { chunks: [] };
  if (!fs.existsSync(ROOT)) return _index;
  for (const f of fs.readdirSync(ROOT)) {
    if (!f.endsWith('.md') || f.startsWith('_')) continue; // pula doc interno (_LEIA.md): NÃO é lei — nunca indexar como artigo
    let txt = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^---[\s\S]*?---\n/, '');
    let secao = '(início)';
    let buf = [];
    const flush = () => {
      for (const ch of segmentar(secao, buf)) {
        _index.chunks.push({ secao: ch.secao, texto: ch.texto, ntexto: norm(ch.texto), nsecao: norm(ch.secao) });
      }
      buf = [];
    };
    for (const raw of txt.split('\n')) {
      const line = raw.trim();
      if (/^#\s/.test(line)) continue;               // "# CONDOMÍNIO GERAL/EDILÍCIO" e o título do doc
      if (/^#{2,3}\s/.test(line)) { flush(); secao = line.replace(/^#{2,3}\s*/, '').trim(); continue; } // ## Tópico / ### Art.
      if (!line) { flush(); continue; }
      buf.push(line);
    }
    flush();
  }
  return _index;
}

function termos(tema) {
  const base = norm(tema).split(' ').filter((w) => w.length >= 3 && !STOP.has(w));
  const set = new Set(base);
  for (const w of base) for (const s of (SYN[w] || [])) set.add(norm(s));
  return [...set];
}

// Ranking compartilhado (consulta e geração usam o MESMO scoring): só ARTIGOS entram, pontua por termo
// no texto (+1) e na seção/título do artigo (+2). Devolve [{c, s}] ordenado por relevância (top-k).
function _rankCC(tema, k) {
  const index = loadIndex();
  if (!index.chunks.length || !tema || !norm(tema)) return [];
  const ts = termos(tema);
  const matchers = ts.map((t) => (t.length <= 3 ? { t, re: new RegExp(`(?:^| )${t}(?: |$)`) } : { t, re: null }));
  const tem = (hay, m) => (m.re ? m.re.test(hay) : hay.includes(m.t));
  return index.chunks
    .filter((c) => /^art 1 /.test(c.nsecao))          // nsecao normalizado: "art 1 336 …"
    .map((c) => {
      let s = 0;
      for (const m of matchers) { if (tem(c.ntexto, m)) s += 1; if (tem(c.nsecao, m)) s += 2; }
      return { c, s };
    }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k);
}

// fundamentoCC("Art. 1.336, IV — …") → "Código Civil (Lei nº 10.406/2002), Art. 1.336, IV".
// Extrai o rótulo "Art. 1.XXX" + o inciso/parágrafo quando houver (o que vai no fundamento do documento);
// sem match, usa a seção inteira. Casa "Art. 1.344" (artigo simples), "Art. 1.336, IV" e "Art. 1.336, § 1º".
function fundamentoCC(secao) {
  const m = String(secao || '').match(/^\s*(Art\.\s*[\d.]+(?:,\s*(?:§\s*\d+º?|Par[aá]grafo [uú]nico|[IVXLC]+))?)/i);
  return `Código Civil (Lei nº 10.406/2002), ${m ? m[1].replace(/\s+/g, ' ').trim() : secao}`;
}

/**
 * consultar_codigo_civil({ tema, k }) — artigos do Código Civil (condomínio) relevantes ao tema.
 * Usar quando a Convenção/Regimento Interno do condomínio NÃO cobre a conduta (Pesquisa 2). O documento
 * cita o artigo LITERAL retornado; se encontrou=false, não há base no CC → humano. NUNCA inventar artigo.
 */
export function consultar_codigo_civil({ tema, k = 4 } = {}) {
  const index = loadIndex();
  if (!index.chunks.length) return { encontrou: false, motivo: 'base_codigo_civil_vazia', artigos: [] };
  if (!tema || !norm(tema)) return { encontrou: false, motivo: 'tema_vazio', artigos: [] };
  const scored = _rankCC(tema, k);
  if (!scored.length) return { encontrou: false, motivo: 'nada_relevante_no_codigo_civil', artigos: [] };
  return {
    encontrou: true,
    artigos: scored.map(({ c }) => ({
      fonte: `Código Civil — ${c.secao}`,
      texto: c.texto.length > 900 ? c.texto.slice(0, 900) + '…' : c.texto, // truncado só p/ EXIBIR na consulta
    })),
  };
}

/**
 * buscarArtigoCC({ tema, k }) — variante para GERAR documento (Pesquisa 2, Etapa 2): mesmo ranking, mas
 * devolve o texto do artigo COMPLETO (verbatim, sem truncar) + o `fundamento` pronto ("Código Civil …,
 * Art. 1.XXX"). Quem gera o documento confirma antes com o verificador de enquadramento e cita o texto
 * daqui — NUNCA do LLM. encontrou:false → não há base no CC.
 */
export function buscarArtigoCC({ tema, k = 3 } = {}) {
  const scored = _rankCC(tema, k);
  if (!scored.length) return { encontrou: false, artigos: [] };
  return {
    encontrou: true,
    artigos: scored.map(({ c }) => ({ fundamento: fundamentoCC(c.secao), secao: c.secao, texto: c.texto })),
  };
}
