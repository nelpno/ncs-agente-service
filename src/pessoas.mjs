// pessoas.mjs — lookup O(1) por CPF no ÍNDICE GLOBAL (tabela `pessoas` no Supabase do NCS).
// A `pessoas` é o espelho dos responsáveis de todos os condomínios, alimentado por um sync periódico
// pela API PÚBLICA (scripts/sync_pessoas.mjs). Substitui a VARREDURA de 59 condos no caminho de CPF
// (que também era CEGA quando o CPF está em 2+ condomínios). Só o caminho de CPF: nome/telefone/unidade
// seguem na varredura (match nuançado). Miss/erro/Supabase-off → retorna null e o chamador cai na
// varredura — o índice NUNCA é caminho crítico. Ver memória ncs-pessoas-indice-cpf.
import { sbEnabled as _sbEnabled, sbSelect as _sbSelect } from './db_ncs.mjs';

const _norm = (s) => String(s || '').toLowerCase();

/**
 * buscarPorCpf(cpfd, { condominio }, deps) → { encontrado, criterio, confianca, unidades } | null
 * MESMO shape do resolver_cadastro (unidades[{id_unidade, identificacao, condominio, id_condominio,
 * papel, papel_nome, nome, ex_morador}]). null = índice não deve/consegue responder → fallback p/ varredura.
 * deps injetável (teste): { sbEnabled, sbSelect }.
 */
export async function buscarPorCpf(cpfd, { condominio } = {}, deps = {}) {
  const sbEnabled = deps.sbEnabled || _sbEnabled;
  const sbSelect = deps.sbSelect || _sbSelect;
  if (!cpfd || !sbEnabled()) return null;

  let rows;
  try {
    rows = await sbSelect('pessoas',
      `doc=eq.${encodeURIComponent(cpfd)}&select=id_condominio,condominio,id_unidade,unidade,bloco,nome,papel,id_label,ativo,dt_saida`);
  } catch { return null; } // erro de rede/Supabase → varredura assume
  if (!Array.isArray(rows) || !rows.length) return null; // miss (cadastro fresco ainda não sincronizado) → varredura

  let use = rows;
  if (condominio) {
    // condomínio informado: o chamador quer a unidade NAQUELE condo. Se o índice não tem a pessoa lá
    // (dado stale/faltando), devolve null → a varredura consulta AO VIVO e filtra pelo condomínio.
    use = rows.filter((r) => _norm(r.condominio).includes(_norm(condominio)));
    if (!use.length) return null;
  }

  const seen = new Set();
  const unidades = [];
  for (const r of use) {
    const k = `${r.id_condominio}:${r.id_unidade}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unidades.push({
      id_unidade: r.id_unidade,
      identificacao: [r.bloco, r.unidade].map((s) => (s || '').trim()).filter(Boolean).join(' / ') || String(r.id_unidade),
      condominio: r.condominio,
      id_condominio: r.id_condominio,
      papel: r.id_label,           // no sweep: papel = r.id_label_tres
      papel_nome: r.papel || null, // no sweep: papel_nome = r.st_nometiporesp_tres
      nome: r.nome,
      ex_morador: !r.ativo,
    });
  }
  if (!unidades.length) return null;
  return { encontrado: true, criterio: 'cpf', confianca: 'alta', unidades, _fonte: 'indice' };
}
