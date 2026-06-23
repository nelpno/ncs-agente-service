// regimento.mjs — consulta ao Regimento Interno / Convenção do condomínio (READ-ONLY, RAG local).
// Piloto: retriever por palavra-chave (normalização + sinônimos de domínio) sobre os .md em data/regimentos/<slug>/.
// Escala: trocar o retriever por busca pgvector mantendo a MESMA assinatura consultar_regimento({condominio, pergunta}).
// Isolamento: SEMPRE filtra por um único condomínio — a regra de um condo nunca vaza para outro (LGPD/jurídico).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', 'data', 'regimentos');

const norm = (s) => (s || '')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const STOP = new Set(('de a o que e do da em um para com nao uma os no se na por mais as dos como mas ao ele das tem seu sua ou ser quando muito ha nos ja esta eu tambem so pelo pela ate isso ela entre era depois sem mesmo aos seus quem nas me esse eles voce essa num nem suas meu minha numa pelos elas qual lhe deles essas esses pra posso pode quero gostaria oi ola tem ter aqui meu sobre qual quais').split(' '));

// sinônimos de domínio condominial → melhora o recall (pergunta usa palavra do morador, doc usa palavra jurídica)
const SYN = {
  cachorro:['animal','animais','pet','cao','caes','bicho'], cao:['animal','animais','pet','caes'], cachorra:['animal','animais','pet'], gato:['animal','animais','pet','gatos'],
  bicho:['animal','animais','pet'], pet:['animal','animais'], animais:['animal','pet'], animal:['animais','pet'],
  barulho:['ruido','som','silencio','sossego','perturbacao','incomodo'], musica:['som','ruido'],
  som:['ruido','barulho'], festa:['som','ruido','convidado','festas'], silencio:['ruido','sossego','barulho'],
  mudanca:['mudanca','transporte'], mudar:['mudanca'], mudancas:['mudanca'],
  churrasco:['grill','gourmet','festas'], churrasqueira:['grill','gourmet','festas'], gourmet:['festas','grill','salao'],
  salao:['festas','gourmet'], piscina:['piscina'], garagem:['garagem','vaga','veiculo','estacionamento','estacionar'],
  carro:['veiculo','garagem','automovel'], veiculo:['garagem','carro'], vaga:['garagem'], estacionar:['garagem','veiculo'],
  varanda:['varanda','sacada','envidracamento','fechamento'], sacada:['varanda','fechamento'],
  vidro:['envidracamento','varanda','fechamento'], envidracar:['varanda','fechamento','envidracamento'],
  obra:['reforma','servico'], reforma:['obra','servico'], multa:['penalidade','advertencia','sancao'],
  penalidade:['multa','advertencia'], advertencia:['penalidade','multa'], lixo:['lixo','residuo'],
  visita:['visitante','hospede','convidado'], visitante:['hospede','convidado'], convidado:['visitante','hospede'],
  bicicleta:['bike','bicicleta'], bike:['bicicleta'], horario:['horario','hora','horas'], hora:['horario'],
  academia:['fitness'], fitness:['academia'], crianca:['playground','recreacao','brinquedoteca','criancas'],
  criancas:['playground','recreacao'], coworking:['coworking','trabalho'], sauna:['sauna','relax'],
  tenis:['quadra'], quadra:['tenis'], mercado:['carrinho','feira'], lavar:['lavagem'],
  fumar:['fumo','cigarro','fumante','tabaco'], cigarro:['fumar','fumo'], fumo:['fumar','cigarro'],
  alugar:['locacao','aluguel','temporada','inquilino','destinacao'], aluguel:['locacao','alugar','temporada'],
  temporada:['locacao','alugar','airbnb','hospedagem'], airbnb:['locacao','temporada','alugar','hospedagem'],
  locacao:['alugar','aluguel','inquilino','destinacao'], hospedagem:['locacao','temporada','airbnb'],
};

let _index = null; // { slug: { nome, chunks:[{docLabel,docTipo,secao,texto,ntexto,nsecao,ataData}] } }

// Detecta o tipo do documento pelo nome do arquivo.
// ATA de assembleia: nome casa /^ata-|assembleia/i (ex.: ata-2025-03-12.md, assembleia-extraordinaria.md).
// Convenção: nome contém "conven". Senão: regimento interno.
// Retorna { docTipo, docLabel, ataData } — ataData é Date|null (só para ATAs com data no nome).
export function classificarDoc(fileName) {
  if (/^ata-|assembleia/i.test(fileName)) {
    const ataData = extrairDataAta(fileName);
    const dataStr = ataData ? fmtData(ataData) : null;
    return { docTipo: 'ata', docLabel: dataStr ? `ATA (${dataStr})` : 'ATA', ataData };
  }
  if (/conven/i.test(fileName)) return { docTipo: 'convencao', docLabel: 'Convenção', ataData: null };
  if (/estatuto/i.test(fileName)) return { docTipo: 'estatuto', docLabel: 'Estatuto', ataData: null }; // associações usam Estatuto no lugar da Convenção
  return { docTipo: 'regimento-interno', docLabel: 'Regimento Interno', ataData: null };
}

// Extrai a data de um nome de arquivo de ATA. Aceita AAAA-MM-DD (preferido) e AAAA_MM_DD.
// Ex.: ata-2025-03-12.md -> Date(2025-03-12). Retorna Date|null.
function extrairDataAta(fileName) {
  const m = fileName.match(/(\d{4})[-_](\d{1,2})[-_](\d{1,2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

// Formata Date -> DD/MM/AAAA (para o docLabel da ATA).
function fmtData(dt) {
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${dt.getFullYear()}`;
}

// Invalida o cache do índice. Uso interno/testes (ex.: após criar uma fixture em disco).
// Não é chamado em runtime do agente — a base é estática enquanto o container vive.
export function _reloadIndex() { _index = null; }

function loadIndex() {
  if (_index) return _index;
  _index = {};
  if (!fs.existsSync(ROOT)) return _index;
  for (const slug of fs.readdirSync(ROOT)) {
    const dir = path.join(ROOT, slug);
    if (!fs.statSync(dir).isDirectory()) continue;
    let nome = slug;
    let aliases = [];
    try { const m = JSON.parse(fs.readFileSync(path.join(dir, '_meta.json'), 'utf8')); nome = m.condominio || slug; aliases = Array.isArray(m.aliases) ? m.aliases : []; } catch {}
    const chunks = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const { docTipo, docLabel, ataData } = classificarDoc(f);
      let txt = fs.readFileSync(path.join(dir, f), 'utf8');
      txt = txt.replace(/^---[\s\S]*?---\n/, '').replace(/<!--[\s\S]*?-->/g, ''); // tira front-matter e marcadores de página
      let secao = '(início)';
      let buf = [];
      const flush = () => {
        const t = buf.join(' ').trim();
        if (t.length > 25) chunks.push({ docLabel, docTipo, secao, texto: t, ntexto: norm(t), nsecao: norm(secao), ataData });
        buf = [];
      };
      for (const raw of txt.split('\n')) {
        const line = raw.trim();
        if (/^#{1,3}\s/.test(line)) { flush(); secao = line.replace(/^#{1,3}\s*/, '').trim(); continue; }
        if (!line) { flush(); continue; }
        buf.push(line);
      }
      flush();
    }
    _index[slug] = { nome, aliases, chunks };
  }
  return _index;
}

function termos(pergunta) {
  const base = norm(pergunta).split(' ').filter((w) => w.length >= 3 && !STOP.has(w));
  const set = new Set(base);
  for (const w of base) for (const s of (SYN[w] || [])) set.add(s);
  return [...set];
}

function resolveCondo(index, condominio) {
  const slugs = Object.keys(index);
  // NUNCA assumir um condomínio: sem condomínio informado, a Ana tem que perguntar.
  // (Isolamento: jamais responder regra do Lume para quem mora em outro condomínio.)
  if (!condominio || !norm(condominio)) return { slug: null, motivo: 'condominio_nao_informado' };
  const c = norm(condominio);
  if (index[c]) return { slug: c };
  // nomes de match por condo = nome canônico + apelidos (ex.: nome do edifício × razão na Superlógica).
  const nomesDe = (s) => [index[s].nome, ...(index[s].aliases || [])].map(norm).filter(Boolean);
  // 1) match EXATO por nome/apelido tem prioridade sobre substring — evita que "Cedros" (175) case "Cedros do Campo" (187).
  const exato = slugs.filter((s) => nomesDe(s).includes(c));
  if (exato.length === 1) return { slug: exato[0] };
  if (exato.length > 1) return { slug: null, motivo: 'condominio_ambiguo' };
  // 2) fallback por substring (comportamento original), agora também sobre apelidos.
  const hit = slugs.filter((s) => nomesDe(s).some((n) => n.includes(c) || c.includes(n)) || s.includes(c));
  if (hit.length === 1) return { slug: hit[0] };
  if (hit.length > 1) return { slug: null, motivo: 'condominio_ambiguo' };
  return { slug: null, motivo: 'condominio_sem_regimento' }; // informado, mas regimento ainda não cadastrado na base
}

/**
 * consultar_regimento({ condominio, pergunta, k })
 * Retorna trechos do regimento/convenção DO CONDOMÍNIO INFORMADO relevantes à pergunta.
 * O agente redige a resposta CITANDO a fonte; se encontrou=false, oferece encaminhar a um humano.
 */
export function consultar_regimento({ condominio, pergunta, k = 6 } = {}) {
  const index = loadIndex();
  const disponiveis = Object.values(index).map((v) => v.nome);
  if (!Object.keys(index).length) return { encontrou: false, motivo: 'base de regimentos vazia', trechos: [] };
  const { slug, motivo } = resolveCondo(index, condominio);
  // motivo: condominio_nao_informado (Ana pergunta) | condominio_sem_regimento (ainda não temos esse condo) | condominio_ambiguo (especificar)
  if (!slug) return { encontrou: false, motivo, condominio_pedido: condominio || null, condominios_disponiveis: disponiveis, trechos: [] };
  if (!pergunta || !norm(pergunta)) return { encontrou: false, motivo: 'pergunta_vazia', trechos: [] };

  const ts = termos(pergunta);
  // matchers: termos curtos (<=3 chars) exigem PALAVRA INTEIRA (evita "cao" ⊂ "convoCAÇÃO"/"instalaCAO");
  // termos longos casam por substring (pega radical/plural). ntexto/nsecao já são normalizados (palavras separadas por espaço).
  const matchers = ts.map((t) => (t.length <= 3 ? { t, re: new RegExp(`(?:^| )${t}(?: |$)`) } : { t, re: null }));
  const tem = (hay, m) => (m.re ? m.re.test(hay) : hay.includes(m.t));
  // 1) Ranqueia por relevância (score). Comparador TOTAL/transitivo: score desc, e como
  //    desempate puro a ATA mais recente sobe (não cria ciclo porque é só tie-break).
  const ranked = index[slug].chunks.map((c) => {
    let s = 0;
    for (const m of matchers) {
      if (tem(c.ntexto, m)) s += 1;
      if (tem(c.nsecao, m)) s += 2; // termo no título da seção pesa mais
    }
    // ATA é deliberação pontual/cronológica: meia-pontuação p/ não dominar a Convenção/RI por casar termo no cabeçalho.
    if (c.docTipo === 'ata') s *= 0.5;
    return { c, s };
  }).filter((x) => x.s > 0).sort((a, b) => {
    if (b.s !== a.s) return b.s - a.s;
    const da = a.c.ataData ? a.c.ataData.getTime() : -Infinity;
    const db = b.c.ataData ? b.c.ataData.getTime() : -Infinity;
    return db - da;
  });

  // 2) Passe cronológico das ATAs: reordena APENAS os trechos de ATA por data desc
  //    (mais recente primeiro), mantendo as posições dos trechos de convenção/regimento.
  //    Assim a deliberação de assembleia mais nova aparece antes da antiga sem bagunçar
  //    o ranking de relevância dos outros documentos. Determinístico/estável.
  const ataSorted = ranked
    .filter((x) => x.c.docTipo === 'ata')
    .sort((a, b) => {
      const da = a.c.ataData ? a.c.ataData.getTime() : -Infinity;
      const db = b.c.ataData ? b.c.ataData.getTime() : -Infinity;
      if (db !== da) return db - da;   // ATA mais recente primeiro
      return b.s - a.s;                 // mesma/sem data → relevância
    });
  let ai = 0;
  const ordered = ranked.map((x) => (x.c.docTipo === 'ata' ? ataSorted[ai++] : x));
  const scored = ordered.slice(0, k);

  if (!scored.length) return { encontrou: false, condominio: index[slug].nome, motivo: 'nada_relevante_no_documento', trechos: [] };
  // Se algum trecho recuperado for de ATA, o resultado é potencialmente cronológico/variável:
  // o agente deve priorizar a ATA mais recente e, na dúvida, sugerir confirmar com a administração.
  const temAta = scored.some(({ c }) => c.docTipo === 'ata');
  return {
    encontrou: true,
    condominio: index[slug].nome,
    contem_ata: temAta,
    ...(temAta ? { aviso_ata: 'Há deliberação(ões) de assembleia entre os trechos. ATAs são cronológicas: vale a mais recente. Na dúvida, sugerir confirmar a regra vigente com a administração.' } : {}),
    trechos: scored.map(({ c }) => ({
      fonte: `${c.docLabel} — ${c.secao}`,
      tipo: c.docTipo,
      ...(c.docTipo === 'ata' && c.ataData ? { data: fmtData(c.ataData) } : {}),
      texto: c.texto.length > 700 ? c.texto.slice(0, 700) + '…' : c.texto,
    })),
  };
}
