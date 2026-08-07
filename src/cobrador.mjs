// cobrador.mjs — "essa cobrança que eu recebi é oficial?" (tool do MORADOR, na Ana).
//
// Origem: conv 693 (06/08, Vida Plena). O morador recebeu WhatsApp de "Vitória (16) 3214-5117"
// cobrando e perguntou se era golpe; a Ana disse que não conseguia validar. O número é do escritório
// CHAGAS & OLIVEIRA, que a planilha do Fernando lista como responsável pela cobrança daquele condomínio.
// Ficou parado porque, no mesmo dia, um atendente disse ao morador que o escritório "não tem vínculo
// com a administradora" — parecia contradição. O Fernando resolveu em 07/08: **o escritório é
// contratado pelo CONDOMÍNIO, não pela NCS**; as duas frases eram verdade. E definiu: a Ana diz na
// hora se a cobrança é oficial e, havendo dúvida, atribui ao humano responsável pela carteira.
//
// 🔴 Duas travas de projeto (guardadas em test_cobrador_oficial.mjs):
//   1. A Ana CONFIRMA o que é oficial e NUNCA acusa de golpe. Chamar de fraude a cobrança de um
//      escritório real é acusação contra terceiro, e ela não tem como saber. Não bateu = vai a humano.
//   2. Esta tool fala com MORADOR: nunca devolve juros, multa, honorários ou parcelamento. Isso é
//      conversa de síndico e vive na consultar_parametros_cobranca, registrada só no Estagiário.
//
// Reusa a MESMA base (data/cobranca/parametros.json) e o MESMO resolvedor de nome de condomínio
// (_filtrarCondos), pela lição de 06/08: matcher próprio erra "Rosas de Ouro" e cola Salto Grande I com III.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _filtrarCondos } from './superlogica.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARQ = path.join(__dirname, '..', 'data', 'cobranca', 'parametros.json');

let _cache = null;
export function _reload(fixture) { _cache = fixture || null; return carregar(); }
function carregar() {
  if (_cache) return _cache;
  try {
    const d = JSON.parse(fs.readFileSync(ARQ, 'utf8'));
    _cache = (d.condominios || d || []).map((c, i) => ({ ...c, id: c.slug || String(i) }));
  } catch { _cache = []; }
  return _cache;
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9@.]+/g, ' ').replace(/\s+/g, ' ').trim();

// Palavras que sozinhas não identificam ninguém: "Dr" casaria 3 escritórios diferentes.
const ESTRUTURAIS = new Set(['dr', 'dra', 'doutor', 'doutora', 'e', 'de', 'da', 'do', 'dos', 'das',
  'escritorio', 'advogados', 'advogado', 'adv', 'assessoria', 'cobranca', 'grupo', 'sr', 'sra']);

const soDigitos = (s) => String(s || '').replace(/\D/g, '');

// _casaCobrador: PURA/testável. Casa o que a pessoa escreveu contra o nome do responsável oficial.
// Basta UMA palavra significativa em comum ("Chagas" identifica CHAGAS & OLIVEIRA) — os nomes da
// base são distintos entre si; o risco real era o oposto, casar por palavra estrutural.
export function _casaCobrador(oficial, quem) {
  const a = norm(oficial), b = norm(quem);
  if (!a || !b) return false;
  const sig = (s) => s.split(' ').filter((t) => t.length >= 3 && !ESTRUTURAIS.has(t));
  const A = sig(a), B = sig(b);
  if (!A.length || !B.length) return false;
  return B.some((t) => A.includes(t)) || A.some((t) => B.includes(t));
}

// Confere também contra o canal oficial cadastrado (e-mail ou telefone), porque é isso que a pessoa
// costuma ter em mãos: o número que ligou ou o e-mail que chegou.
function casaContato(contato, quem) {
  if (!contato || !quem) return false;
  const c = norm(contato), q = norm(quem);
  for (const parte of c.split(/[\s/,;]+/).filter(Boolean)) {
    if (parte.includes('@') && q.includes(parte)) return true;
  }
  const dq = soDigitos(quem);
  if (dq.length >= 8) {
    const dc = soDigitos(contato);
    if (dc.includes(dq) || dq.includes(dc.slice(-8))) return true;
  }
  return false;
}

function oficiaisDe(c) {
  const out = [];
  const add = (nome, papel) => { if (nome && !out.some((o) => norm(o.nome) === norm(nome))) out.push({ nome, papel }); };
  add(c.responsavel, 'cobrança');
  add(c.judicial_responsavel, 'cobrança judicial');
  return out.filter((o) => !/atendimento humano/i.test(o.nome));
}

const MSG_CONTRATADO =
  'Sim, essa cobrança é oficial. Esse escritório é contratado pelo condomínio para conduzir a '
  + 'cobrança — por isso ele fala em nome do condomínio, e não da administradora.';

// verificar_cobranca_oficial: { condominio, quem } → confere | nao_confere | sem_quem |
// condominio_ambiguo | condominio_desconhecido | condominio_nao_informado.
export function verificar_cobranca_oficial({ condominio, quem } = {}) {
  const base = carregar();
  if (!base.length) return { status: 'base_indisponivel', transferir_humano: true };
  if (!condominio || !String(condominio).trim()) {
    return { status: 'condominio_nao_informado', pergunta: 'De qual condomínio é a unidade?' };
  }
  const hits = _filtrarCondos(base, condominio);
  // _filtrarCondos é FILTRO: quando nada casa, devolve a lista inteira → isso NÃO é match.
  if (!hits.length || hits.length === base.length) {
    return {
      status: 'condominio_desconhecido', condominio_pedido: condominio, transferir_humano: true,
      mensagem: 'Não consegui localizar esse condomínio na minha base para confirmar. Vou passar para a equipe conferir com você.',
    };
  }
  if (hits.length > 1) {
    return { status: 'condominio_ambiguo', candidatos: hits.map((h) => h.nome) };
  }
  const c = hits[0];
  const oficiais = oficiaisDe(c);

  if (!quem || !String(quem).trim()) {
    return {
      status: 'sem_quem', condominio: c.nome, oficiais,
      contato_oficial: c.contato_externo || null,
      mensagem: oficiais.length
        ? 'Posso confirmar se a cobrança veio de quem conduz a cobrança neste condomínio — me diga o nome que apareceu na mensagem.'
        : 'Neste condomínio a cobrança é conduzida pela própria administradora.',
    };
  }

  const achou = oficiais.find((o) => _casaCobrador(o.nome, quem)) ||
    (casaContato(c.contato_externo, quem) ? oficiais[0] : null);
  // "NCS"/administradora: quando não há escritório externo, a cobrança é da própria NCS.
  const ehNcs = !achou && /\bncs\b|administradora/i.test(String(quem)) && !oficiais.length;

  if (achou || ehNcs) {
    const nome = achou ? achou.nome : 'Cobrança NCS';
    const ncsPropria = /cobran[çc]a ncs|^ncs$/i.test(nome);
    return {
      status: 'confere', condominio: c.nome, cobrador: nome,
      canal_oficial: c.contato_externo || null,
      mensagem: ncsPropria
        ? 'Sim, essa cobrança é oficial: neste condomínio quem conduz a cobrança é a própria administradora.'
        : MSG_CONTRATADO,
    };
  }

  // 🔴 Não bateu NÃO é "é golpe": pode ser um preposto do escritório, um nome que a pessoa leu errado,
  // ou uma cobrança realmente indevida. Quem decide isso é gente — regra do Fernando (07/08).
  return {
    status: 'nao_confere', condominio: c.nome, informado: String(quem).slice(0, 80),
    oficiais, transferir_humano: true,
    mensagem: 'Esse nome não é o que consta aqui como responsável pela cobrança deste condomínio. '
      + 'Não vou afirmar nada sem conferir: vou passar agora para a nossa equipe verificar com você. '
      + 'Enquanto isso, não faça nenhum pagamento.',
  };
}
