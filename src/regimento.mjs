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
  cachorro:['animal','pet','cao'], cao:['animal','pet'], cachorra:['animal','pet'], gato:['animal','pet'],
  bicho:['animal','pet'], pet:['animal'], animais:['animal','pet'], animal:['pet'],
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
};

let _index = null; // { slug: { nome, chunks:[{docLabel,docTipo,secao,texto,ntexto,nsecao}] } }

function loadIndex() {
  if (_index) return _index;
  _index = {};
  if (!fs.existsSync(ROOT)) return _index;
  for (const slug of fs.readdirSync(ROOT)) {
    const dir = path.join(ROOT, slug);
    if (!fs.statSync(dir).isDirectory()) continue;
    let nome = slug;
    try { const m = JSON.parse(fs.readFileSync(path.join(dir, '_meta.json'), 'utf8')); nome = m.condominio || slug; } catch {}
    const chunks = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const docTipo = /conven/i.test(f) ? 'convencao' : 'regimento-interno';
      const docLabel = docTipo === 'convencao' ? 'Convenção' : 'Regimento Interno';
      let txt = fs.readFileSync(path.join(dir, f), 'utf8');
      txt = txt.replace(/^---[\s\S]*?---\n/, '').replace(/<!--[\s\S]*?-->/g, ''); // tira front-matter e marcadores de página
      let secao = '(início)';
      let buf = [];
      const flush = () => {
        const t = buf.join(' ').trim();
        if (t.length > 25) chunks.push({ docLabel, docTipo, secao, texto: t, ntexto: norm(t), nsecao: norm(secao) });
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
    _index[slug] = { nome, chunks };
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
  const hit = slugs.filter((s) => norm(index[s].nome).includes(c) || c.includes(norm(index[s].nome)) || s.includes(c));
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
  const scored = index[slug].chunks.map((c) => {
    let s = 0;
    for (const t of ts) {
      if (c.ntexto.includes(t)) s += 1;
      if (c.nsecao.includes(t)) s += 2; // termo no título da seção pesa mais
    }
    return { c, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k);

  if (!scored.length) return { encontrou: false, condominio: index[slug].nome, motivo: 'nada_relevante_no_documento', trechos: [] };
  return {
    encontrou: true,
    condominio: index[slug].nome,
    trechos: scored.map(({ c }) => ({
      fonte: `${c.docLabel} — ${c.secao}`,
      texto: c.texto.length > 700 ? c.texto.slice(0, 700) + '…' : c.texto,
    })),
  };
}
