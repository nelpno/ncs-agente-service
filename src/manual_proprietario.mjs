// manual_proprietario.mjs — entrega o MANUAL DO PROPRIETÁRIO (material da construtora sobre o
// IMÓVEL: garantia, manutenção, acabamento) INTEIRO, como anexo, sem fatiar em trecho.
//
// Por que não vive em data/regimentos/: lá o retriever classificaria o arquivo como "Regimento
// Interno" (é o default do classificarDoc) e a Ana passaria a citar manual de construtora como se
// fosse regra do condomínio — mentira de rótulo que pode acabar dentro de uma multa.
//
// Pedido do Fernando (WhatsApp 18/08/2026): "Consegue mandar documento completo tipo PDF? Se o cara
// tiver dúvida, manda o arquivo inteiro. E não separa por trecho." Escopo fechado por ele às 23:37
// do mesmo dia: "Só manual proprietário seiva" — por isso o catálogo tem UM item, e acrescentar
// outro é acrescentar uma linha em data/documentos/manuais.json, não mexer aqui.
//
// O nome do condomínio é resolvido pelo matcher COMPARTILHADO (_filtrarCondos), nunca por um
// próprio: a lição de 06/08 é que matcher caseiro erra "Rosas de Ouro" e cola Salto Grande I com III.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.mjs';
import { _filtrarCondos } from './superlogica.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, '..', 'data', 'documentos');
const CATALOGO = path.join(DIR, 'manuais.json');
const TTL_MS = 30 * 60 * 1000; // 30 min — sobra p/ o adapter baixar e postar, e a URL não vira link eterno

const store = new Map(); // token -> { path, expires }
let _cache = null;

function gc() { const agora = Date.now(); for (const [k, v] of store) if (v.expires < agora) store.delete(k); }

function registrar(filePath, ttl = TTL_MS) {
  gc();
  const token = crypto.randomBytes(16).toString('hex');
  store.set(token, { path: filePath, expires: Date.now() + ttl });
  return token;
}

// só para o teste exercitar a EXPIRAÇÃO (ttl negativo) sem esperar 30 minutos
export function _registrarParaTeste(filePath, ttl) { return registrar(filePath, ttl); }

export function _carregar() {
  if (_cache) return _cache;
  try {
    const j = JSON.parse(fs.readFileSync(CATALOGO, 'utf8'));
    _cache = Array.isArray(j.manuais) ? j.manuais : [];
  } catch { _cache = []; }
  return _cache;
}

// Lido pelo server.mjs na rota GET /manual/<token>. Buffer do PDF ou null (inválido/expirado/sumiu).
export function servirManual(token) {
  gc();
  if (!token) return null;
  const v = store.get(token);
  if (!v || v.expires < Date.now()) return null;
  try { return fs.readFileSync(v.path); } catch { return null; }
}

// Sentinela que nunca casa nada. _filtrarCondos e um FILTRO: quando NENHUM degrau casa ele devolve
// a lista INTEIRA de volta, e o resto do projeto detecta isso por `hits.length === base.length`.
// Aqui esse teste NAO serve: com 1 manual no catalogo, um acerto legitimo tambem devolve 1 item —
// os dois casos ficam indistinguiveis e QUALQUER texto digitado entregaria o manual da Seiva
// (o defeito da conversa 830, de novo). Injetando o sentinela na lista, a distincao volta a existir
// em qualquer tamanho de base: se ele sobreviveu ao filtro, e porque nada foi filtrado.
const SENTINELA = { nome: 'QQQ NENHUM CONDOMINIO QQQ', slug: '__sentinela__', arquivo: '', titulo: '' };

function filtrar(base, condominio) {
  const r = _filtrarCondos([...base, SENTINELA], condominio);
  const devolveuTudo = r.some((c) => c.slug === '__sentinela__');
  const hits = r.filter((c) => c.slug !== '__sentinela__');
  return { hits, achou: !devolveuTudo && hits.length > 0 };
}

/**
 * consultar_manual_proprietario({ condominio })
 * → { ok:true, url, filename, titulo, condominio, paginas } quando aquele condomínio TEM manual.
 * → { ok:false, motivo } em todo o resto. Falha FECHADA de propósito: entregar o manual de um
 *   prédio a morador de outro é pior que não entregar nada.
 */
export function consultar_manual_proprietario({ condominio } = {}) {
  const base = _carregar();
  if (!base.length) return { ok: false, motivo: 'base_indisponivel' };
  if (!condominio || !String(condominio).trim()) {
    return { ok: false, motivo: 'condominio_nao_informado', pergunta: 'De qual condomínio é a sua unidade?' };
  }
  const { hits, achou } = filtrar(base, condominio);
  if (!achou) return { ok: false, motivo: 'condominio_sem_manual', condominio_pedido: condominio };
  if (hits.length > 1) return { ok: false, motivo: 'condominio_ambiguo', candidatos: hits.map((h) => h.nome) };

  const m = hits[0];
  const arq = path.join(DIR, m.arquivo);
  if (!fs.existsSync(arq)) return { ok: false, motivo: 'arquivo_indisponivel', condominio: m.nome };
  const token = registrar(arq);
  return {
    ok: true,
    url: `${config.publicBase}/manual/${token}`,
    filename: `${m.titulo.replace(/[^\w\-]+/g, '-')}-${m.slug}.pdf`,
    titulo: m.titulo,
    condominio: m.nome,
    paginas: m.paginas || null,
  };
}
