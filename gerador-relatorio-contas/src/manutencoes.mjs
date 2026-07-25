// Card 2 do Resumo Financeiro: MANUTENÇÕES PROGRAMADAS (extintor, AVCB, caixa d'água, gás, seguros...).
//
// De onde vem o dado: NÃO existe na API pública v2 — só no painel admin da Superlógica, que exige sessão
// com MFA. Por isso um ESPELHO: scripts/sync_manutencoes.mjs captura o painel (semanal, na máquina do
// Nelson) e grava na tabela `manutencoes_agenda` do Supabase; aqui só se LÊ.
//
// Regras (determinístico, zero LLM):
//   - "Em atraso"  = o painel marcou Atrasado (é ele que sabe; não recalculamos por data).
//   - "No mês"     = manutenções do mês do relatório (inclui as concluídas — é informação boa pro gestor).
//   - "Próximas"   = as seguintes, por proximidade.
//   - A categoria "Teste" (id 2) é lixo de cadastro e nunca entra.
// O card SEMPRE mostra a data da captura (staleness visível) e NUNCA é caminho crítico: falta de dado,
// Supabase fora ou snapshot velho → card omitido, Resumo sai igual.

const MES_ABREV = ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
// sufixo dos campos de recorrência do registro: fl_jan_mc … fl_dez_mc
const MES_CAMPO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const CATEGORIA_IGNORADA = new Set(['2']); // "Teste" — lixo de cadastro
const DIAS_STALE = 45; // acima disso o card avisa que o cronograma pode estar desatualizado

/**
 * Célula do painel → { status, dia }. "Dia 9" → agendado/9 · "Concluido" · "Atrasado" · "Agendado".
 * Célula vazia/desconhecida → null (não vira linha; nunca inventamos status).
 */
export function normalizarCelula(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const dia = s.match(/^dia\s+(\d{1,2})$/i);
  if (dia) return { status: 'agendado', dia: Number(dia[1]) };
  if (/^conclu/i.test(s)) return { status: 'concluido', dia: null };
  if (/^atrasad/i.test(s)) return { status: 'atrasado', dia: null };
  if (/^agendad/i.test(s)) return { status: 'agendado', dia: null };
  return null;
}

/** MM/DD/AAAA (padrão Superlógica) → {ano, mes, dia}. Formato inesperado → null. */
export function parseDataSL(s) {
  const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? { mes: Number(m[1]), dia: Number(m[2]), ano: Number(m[3]) } : null;
}

/**
 * Célula do painel a partir do REGISTRO da API interna (`manutencoes/index`), que traz os meses de
 * recorrência (`fl_jan_mc`…`fl_dez_mc`) e a data da PRÓXIMA manutenção (`dt_manutencao_mc`).
 * Devolve exatamente o texto que o painel mostraria ("Dia 9"/"Concluido"/"Atrasado"/"Agendado"),
 * ou null quando o mês não é de recorrência.
 *
 * A regra foi INFERIDA do dado e conferida contra as 266 células capturadas do HTML do painel
 * em 24/07/2026: **266/266 idênticas**. Se o painel mudar de comportamento, é esse teste que cai.
 *   - mês passado:   a data já rolou pra frente = foi feita ("Concluido"); senão "Atrasado".
 *   - mês corrente:  idem; se a data é deste mês e o dia ainda não chegou, "Dia N".
 *   - mês futuro:    só o mês DA DATA leva o dia (o painel casa por mês, ignorando o ano);
 *                    os demais meses de recorrência saem como "Agendado".
 */
export function derivarCelula(reg, col, hoje) {
  if (!reg || !col) return null;
  if (String(reg[`fl_${MES_CAMPO[col.mes - 1]}_mc`] || '') !== '1') return null;
  const dt = parseDataSL(reg.dt_manutencao_mc);
  if (!dt) return 'Agendado';
  const h = hoje instanceof Date ? hoje : new Date(hoje);
  const hK = h.getUTCFullYear() * 100 + (h.getUTCMonth() + 1);
  const k = col.ano * 100 + col.mes, kdt = dt.ano * 100 + dt.mes;
  if (k < hK) return kdt > k ? 'Concluido' : 'Atrasado';
  if (k === hK) {
    if (kdt > k) return 'Concluido';
    return (kdt === k && dt.dia >= h.getUTCDate()) ? 'Dia ' + dt.dia : 'Atrasado';
  }
  return dt.mes === col.mes ? 'Dia ' + dt.dia : 'Agendado';
}

/** Janela de 12 meses do painel: começa no mês ANTERIOR ao de hoje. */
export function janelaPainel(hoje) {
  const h = hoje instanceof Date ? hoje : new Date(hoje);
  let mes = h.getUTCMonth(); // 0-based = mês anterior em 1-based
  let ano = h.getUTCFullYear();
  if (mes === 0) { mes = 12; ano -= 1; }
  const out = [];
  for (let i = 0; i < 12; i++) {
    out.push({ mes, ano });
    mes += 1; if (mes > 12) { mes = 1; ano += 1; }
  }
  return out;
}

/**
 * Registros da API interna → linhas da tabela. O **id do condomínio vem da própria fonte**
 * (`id_condominio_cond`) — não há casamento por nome, então não há como trocar de prédio.
 */
export function linhasDosRegistros(regs, { capturadoEm, hoje } = {}) {
  const cap = capturadoEm || new Date().toISOString();
  const janela = janelaPainel(hoje || cap);
  const linhas = [], semId = [];
  for (const r of regs || []) {
    const id = Number(r.id_condominio_cond);
    const categoriaId = String(r.id_manutencoes_mt);
    if (CATEGORIA_IGNORADA.has(categoriaId)) continue;
    if (!id) { semId.push(r.st_fantasia_cond || r.st_nome_cond || '?'); continue; }
    for (const col of janela) {
      const bruto = derivarCelula(r, col, hoje || cap);
      const cel = bruto && normalizarCelula(bruto);
      if (!cel) continue;
      linhas.push({
        id_condominio: id, condominio_painel: (r.st_fantasia_cond || r.st_nome_cond || '').trim(),
        categoria_id: categoriaId, categoria: r.st_nome_mt,
        ano: col.ano, mes: col.mes, dia: cel.dia, status: cel.status,
        valor_raw: bruto, capturado_em: cap,
      });
    }
  }
  return { linhas, semId };
}

const chave = (r) => Number(r.ano) * 100 + Number(r.mes);
export const rotuloQuando = (r) => (r.dia ? `${String(r.dia).padStart(2, '0')}/${MES_ABREV[r.mes]}/${r.ano}` : `${MES_ABREV[r.mes]}/${r.ano}`);
const SITUACAO = { atrasado: 'Em atraso', concluido: 'Concluída', agendado: 'Agendada' };

/**
 * Linhas → card do mês do relatório. Devolve null quando não há nada a mostrar (o Resumo sai sem o card).
 * Ordem: atraso → mês do relatório → próximas (por proximidade).
 * O Resumo é um informativo de 1 PÁGINA: no máximo `maxTotal` linhas, com prioridade
 * atraso > mês do relatório > próximas. O que não coube vira contagem explícita (`omitidas`)
 * no rodapé do card — corte silencioso leria como "não há mais nada programado".
 */
export function montarCardManutencoes(linhas, { ano, mes, capturadoEm, maxTotal = 6, maxPorSecao = 3, hoje } = {}) {
  const rows = (linhas || []).filter((r) => r && r.ano && r.mes && !CATEGORIA_IGNORADA.has(String(r.categoria_id)));
  if (!rows.length) return null;
  const ref = Number(ano) * 100 + Number(mes);
  const ord = (a, b) => chave(a) - chave(b) || (a.dia || 32) - (b.dia || 32) || String(a.categoria).localeCompare(String(b.categoria));
  const item = (r) => ({ categoria: r.categoria, quando: rotuloQuando(r), status: r.status, situacao: SITUACAO[r.status] || r.status, ano: r.ano, mes: r.mes, dia: r.dia });

  const todasAtraso = rows.filter((r) => r.status === 'atrasado').sort(ord);
  const todasMes = rows.filter((r) => r.status !== 'atrasado' && chave(r) === ref).sort(ord);
  const todasProx = rows.filter((r) => r.status !== 'atrasado' && chave(r) > ref).sort(ord);
  const atrasadas = todasAtraso.slice(0, maxPorSecao).map(item);
  const noMes = todasMes.slice(0, maxPorSecao).map(item);
  const proximas = todasProx.slice(0, Math.max(0, maxTotal - atrasadas.length - noMes.length)).map(item);
  if (!atrasadas.length && !noMes.length && !proximas.length) return null;
  const omitidas = (todasAtraso.length + todasMes.length + todasProx.length) - (atrasadas.length + noMes.length + proximas.length);

  const cap = capturadoEm || (rows.find((r) => r.capturado_em) || {}).capturado_em || null;
  const agora = hoje ? new Date(hoje) : new Date();
  const dias = cap ? Math.floor((agora - new Date(cap)) / 86400000) : null;
  return {
    atrasadas, noMes, proximas, omitidas,
    rotuloMes: `${MES_ABREV[Number(mes)]}/${ano}`,
    capturadoEm: cap,
    capturadoEmBR: cap ? new Date(cap).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null,
    diasDesdeCaptura: dias,
    desatualizado: dias != null && dias > DIAS_STALE,
  };
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * HTML do card (mesma linguagem visual do Card 1). Card ausente → string vazia.
 * Tabela ÚNICA (sem linhas de seção) para o Resumo caber em 1 página: a coluna "situação"
 * já diz Em atraso/Agendada/Concluída e a data diz quando — as seções só gastavam altura.
 */
export function renderCardManutencoes(card) {
  if (!card) return '';
  const linha = (it) => `<tr class="${it.status === 'atrasado' ? 'atr' : ''}"><td>${esc(it.categoria)}</td><td class="q">${esc(it.quando)}</td><td class="s">${esc(it.situacao)}</td></tr>`;
  const nota = [
    card.capturadoEmBR ? `Cronograma conforme o sistema em ${card.capturadoEmBR}.` : '',
    card.desatualizado ? 'Pode haver agendamento mais recente não refletido aqui.' : '',
    card.omitidas === 1 ? 'Outra manutenção programada não coube neste resumo.'
      : card.omitidas ? `Outras ${card.omitidas} manutenções programadas não couberam neste resumo.` : '',
  ].filter(Boolean).join(' ');
  const itens = [...card.atrasadas, ...card.noMes, ...card.proximas];
  return `<div class="manut"><span class="mh">MANUTENÇÕES PROGRAMADAS</span>
<table class="mt">${itens.map(linha).join('')}</table>
${nota ? `<div class="mn">${esc(nota)}</div>` : ''}</div>`;
}

// ---- leitura do espelho (Supabase) — nunca caminho crítico ----
const SB_URL = () => process.env.SUPABASE_URL;
const SB_KEY = () => process.env.SUPABASE_SERVICE_KEY;
export const espelhoLigado = () => !!(SB_URL() && SB_KEY());

/**
 * buscarManutencoes(idCondominio, {ano, mes}) → card | null.
 * Supabase desligado, erro de rede ou condomínio sem cronograma → null (o Resumo segue sem o card).
 */
export async function buscarManutencoes(idCondominio, { ano, mes } = {}, deps = {}) {
  const _fetch = deps.fetch || fetch;
  if (!espelhoLigado() || !idCondominio) return null;
  try {
    const qs = `id_condominio=eq.${encodeURIComponent(idCondominio)}&select=categoria,categoria_id,ano,mes,dia,status,capturado_em&order=ano.asc,mes.asc`;
    const r = await _fetch(`${SB_URL()}/rest/v1/manutencoes_agenda?${qs}`, {
      headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(Number(process.env.SB_TIMEOUT_MS || 15000)),
    });
    if (!r.ok) return null;
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) return null;
    return montarCardManutencoes(rows, { ano, mes, capturadoEm: rows[0].capturado_em });
  } catch { return null; }
}
