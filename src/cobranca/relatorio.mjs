// relatorio.mjs — resumo dos BLOQUEADOS da leva de cobrança, pro DIGEST.
// Princípio do Fable: o balde BLOQUEADO nunca pode sumir num log — vira contagem EMPURRADA (quem nunca é cobrado
// e por quê). Ex.: "12 unidades sem cobrança: 9 sem e-mail, 2 judicial, 1 garantidora". PURO/testável.

const ROTULO = {
  sem_email: 'sem e-mail cadastrado',
  judicial: 'em processo judicial',
  garantidora: 'geridos por garantidora',
  ja_em_acordo: 'já em acordo',
};

/**
 * resumoBloqueados(leva) → { total, por_motivo, unidades, frase }
 *  - total: nº de unidades no balde 'bloqueado'.
 *  - por_motivo: contagem por motivo (uma unidade pode ter +1 motivo).
 *  - unidades: [{ id, label, motivos }] (pro Portal listar/agir com 1 clique).
 *  - frase: linha pronta pro digest mensal.
 */
export function resumoBloqueados(leva = {}) {
  const bloq = (leva.unidades || []).filter((u) => u.balde === 'bloqueado');
  const por_motivo = {};
  for (const u of bloq) for (const m of (u.motivos || [])) por_motivo[m] = (por_motivo[m] || 0) + 1;

  const unidades = bloq.map((u) => ({
    id: u.unidade?.id_unidade ?? null,
    label: u.unidade?.unidade_label ?? String(u.unidade?.id_unidade ?? ''),
    motivos: u.motivos || [],
  }));

  const detalhe = Object.entries(por_motivo)
    .sort((a, b) => b[1] - a[1])
    .map(([m, n]) => `${n} ${ROTULO[m] || m}`)
    .join(', ');
  const frase = bloq.length
    ? `${bloq.length} unidade(s) sem cobrança${detalhe ? `: ${detalhe}` : ''}.`
    : '';

  return { total: bloq.length, por_motivo, unidades, frase };
}
