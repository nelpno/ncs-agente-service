// Núcleo reusável: busca os dados, agrega (determinístico) e monta o HTML do relatório.
// NÃO renderiza PDF — quem chama decide o render (CLI local = render.mjs Windows; container = gerador/render-pdf.mjs).
import * as SL from './superlogica-financeiro.mjs';
import { agregar } from './agregar.mjs';
import { textoExecutivo } from './texto-executivo.mjs';
import { renderHTML } from './template.mjs';

/**
 * montarRelatorio({ idCondominio, ano, mes, nome, chat?, log? }) → { modelo, texto, html }
 *  - `chat`: cliente LLM injetado (opcional) p/ o texto executivo; sem ele usa env/fallback determinístico.
 */
export async function montarRelatorio({ idCondominio, ano, mes, nome, chat, log } = {}) {
  const { dtInicio, dtFim } = SL.periodoMes(ano, mes);
  const prevAno = mes === 1 ? ano - 1 : ano, prevMes = mes === 1 ? 12 : mes - 1;
  const pp = SL.periodoMes(prevAno, prevMes);

  const [balancete, orcamento, caixa, contas, inadimplencia, prevBal] = await Promise.all([
    SL.balancete(idCondominio, dtInicio, dtFim),
    SL.orcamento(idCondominio),
    SL.caixa(idCondominio, dtInicio, dtFim),
    SL.contasBancarias(idCondominio),
    SL.inadimplenciaResumo(idCondominio),
    SL.balancete(idCondominio, pp.dtInicio, pp.dtFim).catch(() => null),
  ]);

  const snap = { balancete, orcamento, caixa, contas, inadimplencia };
  const modelo = agregar(snap, { ano, mes, condominio: { nome, id: idCondominio }, prevBalancete: prevBal });
  const texto = await textoExecutivo(modelo, { chat, log });
  const html = renderHTML(modelo, texto);
  return { modelo, texto, html };
}

export { SL };
