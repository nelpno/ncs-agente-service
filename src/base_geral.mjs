// base_geral.mjs — BASE INSTITUCIONAL GLOBAL da Ana (READ-ONLY, RAG local).
// Conhecimento que NÃO é por condomínio: portfólio NCS, Clube NCS, projetos, terceirização, "A Empresa" — IGUAL para todos.
// Mesma mecânica de retriever do regimento.mjs (normalização + sinônimos + scoring por seção), MAS:
//   - SEM filtro por condomínio (a base é institucional/global);
//   - varre os .md em data/base-geral/ (não data/regimentos/<slug>/).
// Escala: trocar o retriever por busca pgvector mantendo a MESMA assinatura consultar_base_geral({pergunta, k}).
// Anti-alucinação: se nada relevante, retorna { encontrou:false } — o agente oferece ajuda humana, NUNCA inventa.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', 'data', 'base-geral');

const norm = (s) => (s || '')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const STOP = new Set(('de a o que e do da em um para com nao uma os no se na por mais as dos como mas ao ele das tem seu sua ou ser quando muito ha nos ja esta eu tambem so pelo pela ate isso ela entre era depois sem mesmo aos seus quem nas me esse eles voce essa num nem suas meu minha numa pelos elas qual lhe deles essas esses pra posso pode quero gostaria oi ola tem ter aqui meu sobre qual quais').split(' '));

// sinônimos de domínio institucional → melhora o recall (palavra do morador × palavra do site).
const SYN = {
  desconto:['vantagem','beneficio','vantagens','beneficios','clube','parceiro','parceira','parceiros'],
  descontos:['vantagem','beneficio','clube','parceiro'], vantagem:['desconto','beneficio','clube'],
  vantagens:['desconto','beneficio','clube'], beneficio:['desconto','vantagem','clube'],
  beneficios:['desconto','vantagem','clube'], clube:['vantagem','desconto','parceiro','beneficio'],
  parceiro:['clube','desconto','empresa','estabelecimento'], parceiros:['clube','desconto','empresa'],
  parceria:['clube','parceiro','empresa'], cupom:['desconto','clube'],
  empresa:['ncs','administradora','grupo'], administradora:['empresa','ncs','grupo','administracao'],
  grupo:['ncs','empresa'], ncs:['grupo','empresa','administradora'],
  terceirizacao:['terceirizado','maodeobra','portaria','limpeza','zeladoria','conservacao','servico'],
  terceirizado:['terceirizacao','maodeobra','servico'], portaria:['terceirizacao','vigia','ronda','seguranca'],
  limpeza:['conservacao','terceirizacao','zeladoria'], zeladoria:['terceirizacao','limpeza','conservacao'],
  conservacao:['limpeza','terceirizacao'], vigia:['portaria','ronda','seguranca','vigilancia'],
  ronda:['portaria','vigia','seguranca'], manutencao:['predial','servico','terceirizacao'],
  sindico:['sindicos','academia','momento','administracao'], sindicos:['sindico','academia'],
  academia:['sindico','treinamento','palestra','projeto','capacitacao'],
  projeto:['projetos','academia','momento','happy','clube'], projetos:['projeto','academia','momento'],
  servico:['servicos','terceirizacao','administracao'], servicos:['servico','portfolio','administracao'],
  portfolio:['servico','servicos'], administracao:['administradora','gestao','condominio','servico'],
  gestao:['administracao','administradora'], condominio:['administracao','associacao','condominios'],
  associacao:['condominio','administracao'], app:['aplicativo','area','condomino'],
  aplicativo:['app','area','condomino'], assembleia:['convocacao','edital','ata','administracao'],
  boleto:['boletos','financeiro','administracao'], contato:['telefone','whatsapp','endereco','falar'],
  endereco:['rua','avenida','localizacao','contato'], localizacao:['endereco','araraquara','sede'],
  araraquara:['sede','endereco','localizacao'], qrcode:['qr','codigo','clube','escanear'],
  escanear:['qrcode','qr','clube'], delivery:['entrega','clube'], pet:['petshop','animal','clube'],
  restaurante:['alimentacao','comida','clube'], salao:['beleza','estetica','clube'],
  // dívida / cobrança / negociação / CND — melhora o recall dos formulários financeiros (Negociação, CND)
  debito:['divida','debitos','negociacao','parcelamento','cobranca','atraso','pendencia'],
  debitos:['divida','debito','negociacao','parcelamento','cobranca'], divida:['debito','debitos','negociacao','parcelamento','atraso'],
  dividas:['divida','debito','negociacao','parcelamento'], negociar:['negociacao','parcelamento','acordo','debito','divida'],
  negociacao:['negociar','parcelamento','acordo','debito','divida'], parcelar:['parcelamento','negociacao','debito','divida'],
  parcelamento:['parcelar','negociacao','acordo','debito'], acordo:['negociacao','parcelamento','debito'],
  atraso:['atrasado','debito','divida','inadimplente','cobranca'], atrasado:['atraso','debito','inadimplente'],
  inadimplente:['debito','divida','atraso','cobranca'], inadimplencia:['debito','divida','atraso','cobranca'],
  cnd:['certidao','negativa','debito','quitacao','quitado'], certidao:['cnd','negativa','debito','quitacao'],
  quitacao:['quitado','cnd','adimplente','negativa'], quitado:['quitacao','cnd','adimplente'],
};

let _index = null; // { chunks:[{ arquivo, doc, secao, texto, ntexto, nsecao }] }

function loadIndex() {
  if (_index) return _index;
  _index = { chunks: [] };
  if (!fs.existsSync(ROOT)) return _index;
  for (const f of fs.readdirSync(ROOT)) {
    if (!f.endsWith('.md')) continue;
    let txt = fs.readFileSync(path.join(ROOT, f), 'utf8');
    txt = txt.replace(/^---[\s\S]*?---\n/, '').replace(/<!--[\s\S]*?-->/g, ''); // tira front-matter e marcadores
    // título do documento (1ª linha "# ...") = rótulo da fonte; default = nome do arquivo
    let doc = f.replace(/^site-/, '').replace(/\.md$/, '');
    const mTit = txt.match(/^#\s+(.+)$/m);
    if (mTit) doc = mTit[1].trim();
    let secao = '(início)';
    let buf = [];
    const flush = () => {
      const t = buf.join(' ').trim();
      if (t.length > 25) _index.chunks.push({ arquivo: f, doc, secao, texto: t, ntexto: norm(t), nsecao: norm(secao) });
      buf = [];
    };
    for (const raw of txt.split('\n')) {
      const line = raw.trim();
      if (/^#\s/.test(line)) continue; // ignora o título "# " do documento (já capturado em doc)
      if (/^#{2,3}\s/.test(line)) { flush(); secao = line.replace(/^#{2,3}\s*/, '').trim(); continue; }
      if (!line) { flush(); continue; }
      buf.push(line);
    }
    flush();
  }
  return _index;
}

function termos(pergunta) {
  const base = norm(pergunta).split(' ').filter((w) => w.length >= 3 && !STOP.has(w));
  const set = new Set(base);
  for (const w of base) for (const s of (SYN[w] || [])) set.add(s);
  return [...set];
}

/**
 * consultar_base_geral({ pergunta, k })
 * Retorna trechos da BASE INSTITUCIONAL GLOBAL (portfólio, Clube NCS, projetos, terceirização, "A Empresa")
 * relevantes à pergunta. SEM filtro por condomínio (institucional, igual para todos).
 * O agente redige a resposta CITANDO a fonte; se encontrou=false, oferece encaminhar a um humano — NUNCA inventa.
 */
export function consultar_base_geral({ pergunta, k = 6 } = {}) {
  const index = loadIndex();
  if (!index.chunks.length) return { encontrou: false, motivo: 'base_geral_vazia', trechos: [] };
  if (!pergunta || !norm(pergunta)) return { encontrou: false, motivo: 'pergunta_vazia', trechos: [] };

  const ts = termos(pergunta);
  const scored = index.chunks.map((c) => {
    let s = 0;
    for (const t of ts) {
      if (c.ntexto.includes(t)) s += 1;
      if (c.nsecao.includes(t)) s += 2; // termo no título da seção pesa mais
    }
    return { c, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k);

  if (!scored.length) return { encontrou: false, motivo: 'nada_relevante_na_base_geral', trechos: [] };
  return {
    encontrou: true,
    trechos: scored.map(({ c }) => ({
      fonte: `${c.doc} — ${c.secao}`,
      texto: c.texto.length > 700 ? c.texto.slice(0, 700) + '…' : c.texto,
    })),
  };
}
