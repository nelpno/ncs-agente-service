// espelho.mjs — Espelho PASSIVO dos tickets do Octadesk (fase 0 da saída do Octadesk).
// Só LÊ o Octadesk e ESCREVE na tabela `solicitacoes` do NOSSO Supabase. Não responde ticket,
// não muda nada no Octadesk → não tem como parar a operação atual (o "com calma" do Fernando).
// REVERSÍVEL: com ESPELHO_ENABLED != 'true' o worker nem inicia (env, sem rebuild).
// Gera um protocolo NCS próprio e guarda o vínculo (octadesk_id) p/ ninguém perder histórico na transição.
// ⚠️ LGPD: a linha espelhada guarda só NOME + assunto + tipo — NUNCA telefone/CPF/e-mail (esses seguem no
// Octadesk, que é a fonte). Ver test_espelho.mjs (checa que a linha inteira não vaza telefone).
import { listarTickets as _listarTickets } from './octadesk.mjs';
import { sbEnabled as _sbEnabled, sbSelect as _sbSelect, sbInsert as _sbInsert, sbUpdate as _sbUpdate } from './db_ncs.mjs';

// Classificador tipo→setor por palavra-chave no ASSUNTO. Determinístico, sem LLM (barato e testável).
// Ordem importa: o mais específico primeiro (primeiro match vence). É triagem, não veredito.
const REGRAS = [
  { tipo: 'titularidade', setor: 'Recepção', re: /titularidad|compra e venda|novo propriet|transfer.*propriet/i },
  { tipo: 'cadastro_dependente', setor: 'Recepção', re: /dependente|meu filho|c[ôo]njuge|familiar/i },
  { tipo: 'cadastro_inquilino', setor: 'Recepção', re: /inquilin|locat[aá]ri|loca[cç][ãa]o|cadastr.*(inquilin|morador|residente)|novo morador/i },
  { tipo: 'mudanca', setor: 'Recepção', re: /mudan[cç]a|sa[íi]da (do|de) (inquilin|morador|condom)|autoriza.*mudan|m[óo]ve(l|is)|desocupa|retirada/i },
  { tipo: 'cnd', setor: 'Financeiro', re: /\bcnd\b|certid[ãa]o negativa|declara[cç][ãa]o de quita/i },
  { tipo: 'boleto_2via', setor: 'Financeiro', re: /2[ªa]?\s*via|boleto|segunda via/i },
  { tipo: 'negociacao', setor: 'Financeiro', re: /negocia|acordo|parcel|d[ée]bito|inadimpl/i },
  { tipo: 'clube', setor: 'Atendimento', re: /club|vantage|desconto/i },
  { tipo: 'evento', setor: 'Atendimento', re: /evento|presen[cç]a|confirma[cç].*presen/i },
  { tipo: 'portaria_acesso', setor: 'Gerência', re: /portaria|shielder|garagem|vaga|controle de acesso/i },
  { tipo: 'ocorrencia', setor: 'Gerência', re: /vazament|infiltra|\bobra\b|manuten|reparo|conserto|barulho|reclama/i },
  { tipo: 'prestador', setor: 'Comercial', re: /fornecimento|fornecedor|parceria|or[cç]amento|proposta de|colaborador|curr[ií]culo/i },
  { tipo: 'cadastro', setor: 'Recepção', re: /cadastr|registr/i },
];
export function classificar(assunto = '') {
  const s = String(assunto || '');
  for (const r of REGRAS) if (r.re.test(s)) return { tipo: r.tipo, setor: r.setor };
  return { tipo: 'outro', setor: 'Atendimento geral' };
}

// setor canônico de um tipo (fonte única = REGRAS). Usado quando o tipo JÁ é conhecido a montante
// (ex.: escrita-ERP, em que a Ana sabe que é cadastro_inquilino) e não dá p/ derivar do assunto.
// Tipo fora do mapa → 'Atendimento geral'.
export function setorDoTipo(tipo) {
  const r = REGRAS.find((x) => x.tipo === tipo);
  return r ? r.setor : 'Atendimento geral';
}

// Protocolo NCS próprio (rastreável ao número do Octadesk, mas o prefixo NCS começa a independência).
export function protocoloNcs(octadeskNumber, octadeskId) {
  const n = String(octadeskNumber ?? '').replace(/\D/g, '');
  return `NCS-${n || octadeskId || 'x'}`;
}

// Requester SÓ com nome (LGPD: nunca telefone/CPF/e-mail no espelho — o detalhe fica no Octadesk).
function requesterNome(t) {
  const r = t.requester || t.contact || t.createdBy || {};
  const nome = r.name || r.nome || r.displayName || '';
  return String(nome).trim() || null;
}
const statusOcta = (t) => String(t.status?.name || t.status || t.statusType || '').toLowerCase() || null;
const assuntoDe = (t) => t.subject || t.summary || t.title || t.name || '';

// Monta a linha `solicitacoes` a partir do ticket cru — SÓ campos estruturados + nome (sem raw/PII).
export function montarLinha(t) {
  const octadeskId = String(t.id ?? t._id ?? '');
  const number = t.number ?? t.ticketNumber ?? t.protocol ?? octadeskId;
  const assunto = assuntoDe(t);
  const { tipo, setor } = classificar(assunto);
  return {
    protocolo_ncs: protocoloNcs(number, octadeskId),
    octadesk_id: octadeskId,
    octadesk_number: String(number),
    tipo, setor,
    assunto: assunto ? String(assunto).slice(0, 300) : null,
    status: statusOcta(t),
    requester: requesterNome(t),
    octadesk_criado_em: t.createdAt || t.criadoEm || null,
  };
}

// Upsert por octadesk_id: existe? PATCH status/atualizado_em se mudou; não existe? INSERT. Helpers testados.
async function upsert(linha, io) {
  const sbSelect = io.sbSelect || _sbSelect;
  const sbInsert = io.sbInsert || _sbInsert;
  const sbUpdate = io.sbUpdate || _sbUpdate;
  const achado = await sbSelect('solicitacoes', `octadesk_id=eq.${encodeURIComponent(linha.octadesk_id)}&select=id,status`);
  if (achado.length) {
    const cur = achado[0];
    if (cur.status !== linha.status) {
      await sbUpdate('solicitacoes', `id=eq.${cur.id}`, { status: linha.status, atualizado_em: new Date().toISOString() });
      return 'atualizado';
    }
    return 'inalterado';
  }
  await sbInsert('solicitacoes', linha);
  return 'novo';
}

/**
 * sincronizar({limit, paginas}, io?) — lê tickets do Octadesk e espelha em `solicitacoes` (PASSIVO).
 * io injetável p/ teste ({listarTickets, sbSelect, sbInsert, sbUpdate}). Nunca falha calado: erro por
 * ticket vira contador `erros` + console.warn, sem derrubar o lote.
 * @returns {vistos, novos, atualizados, inalterados, erros}
 */
export async function sincronizar({ limit = 50, paginas = 1 } = {}, io = {}) {
  const listar = io.listarTickets || _listarTickets;
  const out = { vistos: 0, novos: 0, atualizados: 0, inalterados: 0, erros: 0 };
  for (let p = 1; p <= paginas; p++) {
    let tickets;
    try { tickets = await listar({ limit, page: p }); }
    catch (e) { console.warn('[espelho] listar página', p, 'falhou:', e.message); break; }
    if (!tickets.length) break;
    for (const t of tickets) {
      out.vistos++;
      try {
        const r = await upsert(montarLinha(t), io);
        out[r === 'novo' ? 'novos' : r === 'atualizado' ? 'atualizados' : 'inalterados']++;
      } catch (e) { out.erros++; console.warn('[espelho] upsert falhou:', e.message); }
    }
    if (tickets.length < limit) break; // última página
  }
  return out;
}

const habilitado = () => process.env.ESPELHO_ENABLED === 'true';

/**
 * startEspelhoWorker({intervalMs?}) — timer periódico. NÃO inicia se ESPELHO_ENABLED != 'true' (reversível
 * por env, sem rebuild) nem sem Supabase. .unref() p/ não segurar o processo. Molde do startOutboxWorker.
 */
export function startEspelhoWorker({ intervalMs = 300000 } = {}) {
  if (!habilitado()) { console.log('[espelho] desligado (ESPELHO_ENABLED != true)'); return null; }
  if (!_sbEnabled()) { console.warn('[espelho] sem Supabase — não inicia'); return null; }
  console.log('[espelho] worker ativo | intervalo', Math.round(intervalMs / 1000) + 's');
  const tick = () => sincronizar({ limit: 50, paginas: 5 }).then(
    (r) => console.log('[espelho] sync', JSON.stringify(r)),
    (e) => console.warn('[espelho] sync falhou:', e.message),
  );
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return timer;
}
