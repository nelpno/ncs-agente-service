// leva.mjs — orquestrador da cobrança +30d por condomínio (LEITURA, sem escrita).
// Junta: resumo (contato: email/cpf/nome) + detalhe por unidade (recebimento[].encargos) + garantidora + tentativas
// já feitas (CRM) → normaliza → classifica nos 3 baldes → aplica a régua (33/43/60) por unidade.
// I/O por INJEÇÃO DE DEPENDÊNCIA (deps) — testável offline; a fiação real com a API Superlógica vive em outra camada fina.
import { normalizarUnidade, extrairContato, classificarUnidade } from './inadimplentes.mjs';
import { tentativaDaRegua } from './regua.mjs';

// diasAtrasoElegivel: maior atraso entre os boletos que a NCS pode cobrar (>= minDias, não judicial, não em acordo).
// É o atraso que dirige a régua da unidade. 0 se não há boleto elegível.
function diasAtrasoElegivel(unidade, minDias) {
  const eleg = (unidade.boletos || []).filter((b) => Number(b.dias_atraso) >= minDias && !b.em_processo && !b.em_acordo);
  return eleg.reduce((m, b) => Math.max(m, Number(b.dias_atraso) || 0), 0);
}

/**
 * montarLevaCondo(condominioId, deps, opts?) → {
 *   condominio_id, unidades: [{ unidade, balde, motivos, valor_corrigido, qtd_boletos, regua }],
 *   para_hoje: [unidades PRONTO/REVISAR com regua.enviar], totais
 * }
 * deps (todas async, exceto garantidoraDe que pode ser sync):
 *   listarResumo(condId) → [resumoRows]           (inadimplencia/index?apenasResumoInad=1 — traz contato)
 *   detalharUnidade(condId, uid) → detalheRow     (inadimplencia/index?UNIDADES[0]=uid — traz encargos+processos)
 *   garantidoraDe(condId) → {tipo}|null
 *   contarTentativas(condId, uid) → number         (historicocobranca/index — quantas tentativas já registradas)
 * opts repassa ao classificador (minDias/valorAltoMult/taxaMensal/revisarInteracaoDias) e à régua (marcos).
 */
export async function montarLevaCondo(condominioId, deps = {}, opts = {}) {
  const minDias = opts.minDias ?? 30;
  const resumo = (await deps.listarResumo(condominioId)) || [];
  const garantidora = deps.garantidoraDe ? await deps.garantidoraDe(condominioId) : null;

  const unidades = [];
  for (const row of resumo) {
    const uid = row.id_unidade_uni;
    const detalhe = await deps.detalharUnidade(condominioId, uid);
    if (!detalhe) continue; // sem detalhe → pula (nada a classificar); o wrapper real loga
    const contato = extrairContato(row);
    const tentativasFeitas = deps.contarTentativas ? await deps.contarTentativas(condominioId, uid) : 0;

    const unidade = normalizarUnidade(detalhe, { ...contato, garantidora });
    const classif = classificarUnidade(unidade, opts);
    const regua = tentativaDaRegua({ diasAtraso: diasAtrasoElegivel(unidade, minDias), tentativasFeitas }, opts);
    unidades.push({ unidade, ...classif, regua });
  }

  // para_hoje = quem pode ser cobrado (pronto/revisar) E a régua manda enviar hoje.
  const para_hoje = unidades.filter((u) => (u.balde === 'pronto' || u.balde === 'revisar') && u.regua.enviar);
  const cont = (b) => unidades.filter((u) => u.balde === b).length;
  return {
    condominio_id: condominioId,
    unidades,
    para_hoje,
    totais: {
      unidades: unidades.length,
      prontos: cont('pronto'), revisar: cont('revisar'), bloqueados: cont('bloqueado'), ignorados: cont('nenhum'),
      para_hoje: para_hoje.length,
    },
  };
}
