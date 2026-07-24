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
  indenizar:['dano','danos','perdas','responde','reparar'], prejuizo:['dano','danos','perdas','indenizar'],
  barulho:['sossego','prejudicial','ruido','som','perturbar','salubridade','costumes'],
  ruido:['barulho','sossego','prejudicial','som'], som:['barulho','sossego','prejudicial'],
  sossego:['barulho','prejudicial','salubridade','costumes','perturbar'],
  perturbacao:['sossego','prejudicial','barulho','perturbar'], perturbar:['sossego','prejudicial','barulho'],
  vizinho:['possuidores','sossego','salubridade','seguranca','prejudicial'],
  uso:['destinacao','prejudicial','usar','fruir','fim'], destinacao:['uso','fim','prejudicial','edificacao'],
  obra:['obras','reforma','seguranca','edificacao','voluptuarias','uteis','necessarias'],
  obras:['obra','reforma','seguranca','voluptuarias','uteis','necessarias'], reforma:['obra','obras','seguranca'],
  fachada:['forma','cor','esquadrias','externas','alterar'], alterar:['fachada','forma','cor','destinacao'],
  multa:['sancoes','pecuniarias','moratoria','deveres','reiteradamente','quintuplo','decuplo','contribuicao'],
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

let _index = null;
function loadIndex() {
  if (_index) return _index;
  _index = { chunks: [] };
  if (!fs.existsSync(ROOT)) return _index;
  for (const f of fs.readdirSync(ROOT)) {
    if (!f.endsWith('.md')) continue;
    let txt = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^---[\s\S]*?---\n/, '');
    let secao = '(início)';
    let buf = [];
    const flush = () => {
      const t = buf.join(' ').trim();
      if (t.length > 25) _index.chunks.push({ secao, texto: t, ntexto: norm(t), nsecao: norm(secao) });
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

/**
 * consultar_codigo_civil({ tema, k }) — artigos do Código Civil (condomínio) relevantes ao tema.
 * Usar quando a Convenção/Regimento Interno do condomínio NÃO cobre a conduta (Pesquisa 2). O documento
 * cita o artigo LITERAL retornado; se encontrou=false, não há base no CC → humano. NUNCA inventar artigo.
 */
export function consultar_codigo_civil({ tema, k = 4 } = {}) {
  const index = loadIndex();
  if (!index.chunks.length) return { encontrou: false, motivo: 'base_codigo_civil_vazia', artigos: [] };
  if (!tema || !norm(tema)) return { encontrou: false, motivo: 'tema_vazio', artigos: [] };
  const ts = termos(tema);
  const matchers = ts.map((t) => (t.length <= 3 ? { t, re: new RegExp(`(?:^| )${t}(?: |$)`) } : { t, re: null }));
  const tem = (hay, m) => (m.re ? m.re.test(hay) : hay.includes(m.t));
  const scored = index.chunks
    .filter((c) => /^art 1 /.test(c.nsecao))          // só ARTIGOS entram (nsecao é normalizado: "art 1 336 …")
    .map((c) => {
      let s = 0;
      for (const m of matchers) { if (tem(c.ntexto, m)) s += 1; if (tem(c.nsecao, m)) s += 2; }
      return { c, s };
    }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k);
  if (!scored.length) return { encontrou: false, motivo: 'nada_relevante_no_codigo_civil', artigos: [] };
  return {
    encontrou: true,
    artigos: scored.map(({ c }) => ({
      fonte: `Código Civil — ${c.secao}`,
      texto: c.texto.length > 900 ? c.texto.slice(0, 900) + '…' : c.texto,
    })),
  };
}
