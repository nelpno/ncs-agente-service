// regua.mjs — régua de cobrança extrajudicial pós-30d (definida pelo Fernando 18/07).
// Pré-30d (lembrete de boleto aos 10/20/30 dias) é do PRÓPRIO Superlógica — fora daqui.
// Nossa F1 = 3 tentativas por E-MAIL nos dias de atraso +33, +43, +60 (3/13/30 dias após o 30º dia).
// PURO/testável: decide, dado o atraso e quantas tentativas já foram registradas (do CRM), se envia HOJE.
// 1 por vez (não pula etapas mesmo em catch-up); esgotada após a 3ª → segue pro extrajudicial (advogado).

export const MARCOS_REGUA = [33, 43, 60];

/**
 * tentativaDaRegua({ diasAtraso, tentativasFeitas=0 }, opts?) → { enviar, etapa, marcoDias, motivo }
 *  - enviar=true  → dispara a etapa `etapa` (1..N) hoje (o marco `marcoDias` já foi atingido).
 *  - enviar=false → motivo 'aguardando' (ainda não chegou no próximo marco) | 'esgotada' (todas as etapas feitas).
 * opts.marcos sobrescreve os dias-marco (default MARCOS_REGUA). A contagem de tentativas vem do CRM (historicocobranca).
 */
export function tentativaDaRegua({ diasAtraso, tentativasFeitas = 0 } = {}, opts = {}) {
  const marcos = Array.isArray(opts.marcos) && opts.marcos.length ? opts.marcos : MARCOS_REGUA;
  const feitas = Number(tentativasFeitas) || 0;
  const atraso = Number(diasAtraso) || 0;

  if (feitas >= marcos.length) return { enviar: false, etapa: null, marcoDias: null, motivo: 'esgotada' };

  const etapa = feitas + 1;              // próxima etapa (1-indexed)
  const marcoDias = marcos[etapa - 1];
  if (atraso >= marcoDias) return { enviar: true, etapa, marcoDias, motivo: 'no_marco' };
  return { enviar: false, etapa, marcoDias, motivo: 'aguardando' };
}
