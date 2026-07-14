// outbox.mjs — outbox de notificações (spec Onda 1 §4.3): sub-sistema genérico reusado por
// cadastro/titularidade e, depois, mudança/cobrança/comunicado. Princípio nº2 do Fable: "nada falha calado" —
// todo destino que não sai sozinho vira PENDÊNCIA VISÍVEL (pendente_humano), nunca só um console.warn perdido.
// Persistência: Supabase (`notificacoes`, dcirzddyoctxugfowvob) quando sbEnabled(); senão fallback in-memory
// (DRY_RUN local / testes offline — mesmo shape das linhas da tabela).
import crypto from 'node:crypto';
import { planejarAviso as _planejarAviso } from './portaria_dispatch.mjs';
import { enviarEmail as _enviarEmail } from './mailer.mjs';
import { sbEnabled as _sbEnabled, sbInsert as _sbInsert, sbSelect as _sbSelect, sbUpdate as _sbUpdate } from './db_ncs.mjs';

const TABLE = 'notificacoes';
export const MAX_TENTATIVAS = 5;

// Fallback in-memory (sbEnabled()===false): mesmo shape das linhas da tabela `notificacoes`.
const _mem = [];
export function _memClear() { _mem.length = 0; }
export function _memAll() { return _mem.slice(); }

function novaLinha({ evento, condominioId, papel, canal, via, endereco, texto, status, draftId }) {
  return {
    id: crypto.randomBytes(8).toString('hex'),
    draft_id: draftId || null,
    evento,
    condominio_id: condominioId,
    papel, canal, via: via || null,
    endereco: endereco || null,
    payload: { texto },
    status, // 'pendente' | 'enviado' | 'falhou' | 'pendente_humano'
    tentativas: 0,
    ultimo_erro: null,
    criado_em: new Date().toISOString(),
    enviado_em: null,
  };
}

/**
 * enfileirarAvisos({evento, condominio, ator, draftId?}, deps?)
 *   → { ok, condominio, enfileirados, pendente_humano, linhas[] }
 * Chama planejarAviso (conector) e grava 1 linha por destino: endereço presente → 'pendente';
 * sem endereço → 'pendente_humano' direto (nada falha calado — não é erro, é gap de dado).
 * deps injetável p/ teste: { sbEnabled, sbInsert, planejarAviso }.
 */
export async function enfileirarAvisos({ evento = 'cadastro', condominio, ator = {}, draftId = null } = {}, deps = {}) {
  const sbEnabled = deps.sbEnabled || _sbEnabled;
  const sbInsert = deps.sbInsert || _sbInsert;
  const planejarAviso = deps.planejarAviso || _planejarAviso;

  const plano = await planejarAviso({ evento, condominio, ator });
  if (!plano.ok) return { ok: false, motivo: plano.motivo, condominio, enfileirados: 0, pendente_humano: 0, linhas: [] };

  let enfileirados = 0, pendenteHumano = 0;
  const linhas = [];
  const usaSb = sbEnabled();

  for (const d of plano.destinos) {
    const status = d.status === 'pronto' ? 'pendente' : 'pendente_humano';
    const linha = novaLinha({
      evento, condominioId: plano.condominio, papel: d.papel, canal: d.canal, via: d.via,
      endereco: d.endereco, texto: d.payload, status, draftId,
    });
    try {
      if (usaSb) {
        const salvo = await sbInsert(TABLE, {
          draft_id: linha.draft_id, evento: linha.evento, condominio_id: linha.condominio_id,
          papel: linha.papel, canal: linha.canal, via: linha.via, endereco: linha.endereco,
          payload: linha.payload, status: linha.status,
        });
        linhas.push(salvo);
      } else {
        _mem.push(linha);
        linhas.push(linha);
      }
      enfileirados++;
      if (status === 'pendente_humano') pendenteHumano++;
    } catch (e) {
      // nunca falha calado: se nem enfileirar deu certo, ainda assim vira pendência local visível.
      console.warn('[outbox] falha ao enfileirar destino (não derruba os demais):', e.message);
      const linhaErro = { ...linha, status: 'pendente_humano', ultimo_erro: `falha_ao_enfileirar: ${e.message}` };
      _mem.push(linhaErro);
      linhas.push(linhaErro);
      enfileirados++;
      pendenteHumano++;
    }
  }
  return { ok: true, condominio: plano.condominio, tipo_portaria: plano.tipo_portaria, enfileirados, pendente_humano: pendenteHumano, linhas };
}

async function marcar(row, patch, { usaSb, sbUpdate }) {
  Object.assign(row, patch); // reflete no objeto — no fallback in-memory é a MESMA referência da array
  if (usaSb) await sbUpdate(TABLE, `id=eq.${row.id}`, patch);
}

/**
 * processarPendentes(deps?) → { processados, enviados, pendente_humano, falhou }
 * 1 passada determinística (sem timers, p/ teste): pega status='pendente' e tenta entregar por canal.
 *  - email → mailer (DRY por padrão; só envia de verdade com SMTP configurado). Sucesso → 'enviado'.
 *    Falha → tentativas++; ao atingir MAX_TENTATIVAS vira 'pendente_humano', senão continua 'pendente'
 *    (próxima passada tenta de novo).
 *  - zap_grupo/zap_individual → transporte WhatsApp AINDA NÃO DECIDIDO (spec §5: Cloud API oficial não manda
 *    a grupo; Zuck é risco de ban). Decisão: NUNCA finge envio — marca 'pendente_humano' na hora
 *    com ultimo_erro='transporte_zap_indefinido'. É o caminho mais honesto até o §5 ser resolvido.
 *  - exceção inesperada (não um simples ok:false) → 'falhou' (distinto de pendente_humano; fica visível
 *    pra investigação, mas não é automaticamente re-tentado nesta versão — YAGNI de requeue).
 * deps injetável p/ teste: { sbEnabled, sbSelect, sbUpdate, enviarEmail }.
 */
export async function processarPendentes(deps = {}) {
  const sbEnabled = deps.sbEnabled || _sbEnabled;
  const sbSelect = deps.sbSelect || _sbSelect;
  const sbUpdate = deps.sbUpdate || _sbUpdate;
  const enviarEmail = deps.enviarEmail || _enviarEmail;
  const usaSb = sbEnabled();

  const pendentes = usaSb
    ? await sbSelect(TABLE, 'status=eq.pendente&order=criado_em.asc')
    : _mem.filter((r) => r.status === 'pendente');

  let enviados = 0, pendenteHumano = 0, falhou = 0;
  for (const row of pendentes) {
    try {
      if (row.canal === 'email') {
        const texto = row.payload?.texto || '';
        const r = await enviarEmail({ para: row.endereco, assunto: `NCS — aviso (${row.evento})`, corpo: texto });
        if (r.ok) {
          await marcar(row, { status: 'enviado', enviado_em: new Date().toISOString() }, { usaSb, sbUpdate });
          enviados++;
        } else {
          const tentativas = (row.tentativas || 0) + 1;
          if (tentativas >= MAX_TENTATIVAS) {
            await marcar(row, { status: 'pendente_humano', tentativas, ultimo_erro: r.motivo || 'falha_envio' }, { usaSb, sbUpdate });
            pendenteHumano++;
          } else {
            await marcar(row, { status: 'pendente', tentativas, ultimo_erro: r.motivo || 'falha_envio' }, { usaSb, sbUpdate });
          }
        }
      } else if (row.canal === 'zap_grupo' || row.canal === 'zap_individual') {
        await marcar(row, { status: 'pendente_humano', ultimo_erro: 'transporte_zap_indefinido' }, { usaSb, sbUpdate });
        pendenteHumano++;
      } else {
        await marcar(row, { status: 'pendente_humano', ultimo_erro: `canal_desconhecido:${row.canal}` }, { usaSb, sbUpdate });
        pendenteHumano++;
      }
    } catch (e) {
      const tentativas = (row.tentativas || 0) + 1;
      try { await marcar(row, { status: 'falhou', tentativas, ultimo_erro: e.message }, { usaSb, sbUpdate }); } catch {}
      falhou++;
    }
  }
  return { processados: pendentes.length, enviados, pendente_humano: pendenteHumano, falhou };
}

/**
 * listarPendencias(deps?) → linhas com status 'pendente_humano' ou 'falhou' (fila visível).
 * Em produção o Portal lê o Supabase direto (spec §4.3); isto serve pra teste/diagnóstico local.
 */
export async function listarPendencias(deps = {}) {
  const sbEnabled = deps.sbEnabled || _sbEnabled;
  const sbSelect = deps.sbSelect || _sbSelect;
  if (sbEnabled()) return sbSelect(TABLE, 'status=in.(pendente_humano,falhou)&order=criado_em.desc');
  return _mem.filter((r) => r.status === 'pendente_humano' || r.status === 'falhou');
}

/**
 * startOutboxWorker({intervalMs?}) → Timer. Roda processarPendentes() periodicamente (padrão cronSweep do
 * adapter Chatwoot). .unref() pra não segurar o processo vivo sozinho. Nome exportado é o contrato que o
 * server.mjs (Agente D) consome — não renomear.
 */
export function startOutboxWorker({ intervalMs = 30000 } = {}) {
  const timer = setInterval(() => {
    processarPendentes().catch((e) => console.warn('[outbox] processarPendentes falhou:', e.message));
  }, intervalMs);
  timer.unref?.();
  return timer;
}
