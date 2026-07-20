// sl_read.mjs — adaptador FINO de LEITURA da API Superlógica p/ o orquestrador da cobrança (leva.mjs).
// Só GET. A lógica vive nos módulos puros (classificar/normalizar/regua/leva); aqui é I/O glue, verificado por smoke ao vivo.
// depsSuperlogica(cfg) devolve o objeto `deps` que montarLevaCondo consome.
import { consultar_garantidora } from '../garantidora.mjs';

export function depsSuperlogica({ slBase = 'https://api.superlogica.net/v2/condor', slApp, slAccess, timeoutMs = 20000 } = {}) {
  async function slGet(controllerAction, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const url = `${slBase}/${controllerAction}${qs ? '?' + qs : ''}`;
    const r = await fetch(url, { headers: { app_token: slApp, access_token: slAccess, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw new Error(`Superlógica ${controllerAction} ${r.status}`);
    return r.json();
  }

  return {
    // resumo traz o CONTATO (st_email_con/st_cpf_con/st_nome_con) + id_unidade_uni de cada inadimplente
    listarResumo: async (condId) => {
      const d = await slGet('inadimplencia/index', { idCondominio: condId, apenasResumoInad: 1 });
      return Array.isArray(d) ? d : [];
    },
    // detalhe por unidade traz recebimento[].encargos + processos[]
    detalharUnidade: async (condId, uid) => {
      const d = await slGet('inadimplencia/index', { idCondominio: condId, 'UNIDADES[0]': uid, comValoresAtualizados: 'true' });
      const arr = Array.isArray(d) ? d : [];
      return arr.find((u) => String(u.id_unidade_uni) === String(uid)) || arr[0] || null;
    },
    garantidoraDe: (condId) => {
      const g = consultar_garantidora({ id_condominio: condId });
      return g?.tem ? { tipo: g.tipo } : null;
    },
    // tentativas já registradas no CRM (historicocobranca) — filtra por unidade. Best-effort: shape confirmado quando houver dado.
    contarTentativas: async (condId, uid) => {
      try {
        const d = await slGet('historicocobranca/index', { idCondominio: condId });
        const rows = Array.isArray(d) ? d : [];
        return rows.filter((r) => String(r.id_unidade_uni) === String(uid)).length;
      } catch { return 0; }
    },
  };
}
