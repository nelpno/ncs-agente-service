// Cliente READ-ONLY dos endpoints FINANCEIROS da Superlógica usados no relatório de prestação de contas.
// Datas em MM/DD/AAAA. Filtro de unidade seria UNIDADES[0]= (aqui trabalhamos no nível do condomínio).
// ⚠️ contabancos/index vaza st_token_cb/st_secret_cb → este módulo faz o WHITELIST antes de devolver.
import { loadEnv } from './env.mjs';

loadEnv();
const APP = process.env.SUPERLOGICA_APP_TOKEN;
const ACC = process.env.SUPERLOGICA_ACCESS_TOKEN;
const BASE = process.env.SUPERLOGICA_BASE_URL || 'https://api.superlogica.net/v2/condor';
const TIMEOUT = Number(process.env.SL_TIMEOUT_MS || 25000);
const HEADERS = { app_token: APP, access_token: ACC, 'Content-Type': 'application/json' };

async function slGet(controllerAction, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}/${controllerAction}${qs ? '?' + qs : ''}`;
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT) });
  const txt = await r.text();
  let json = null;
  try { json = JSON.parse(txt); } catch { /* deixa null */ }
  if (!r.ok || json === null) {
    throw new Error(`Superlógica ${controllerAction} HTTP ${r.status}: ${txt.slice(0, 140)}`);
  }
  return json;
}

// data MM/DD/AAAA a partir de {ano, mes(1-12)}: primeiro e último dia do mês
export function periodoMes(ano, mes) {
  const ultimo = new Date(ano, mes, 0).getDate(); // dia 0 do mês seguinte = último do mês
  const mm = String(mes).padStart(2, '0');
  const dd = String(ultimo).padStart(2, '0');
  return { dtInicio: `${mm}/01/${ano}`, dtFim: `${mm}/${dd}/${ano}` };
}

// balancetes/index → [{ nomeplanocontas, itens: [ [obj], [obj], ... ] }]  (cada item vem embrulhado num array de 1)
export async function balancete(idCondominio, dtInicio, dtFim) {
  const raw = await slGet('balancetes/index', { idCondominio, dtInicio, dtFim });
  const bloco = Array.isArray(raw) ? raw[0] : raw;
  const itensRaw = bloco?.itens || [];
  const itens = itensRaw
    .map(x => (Array.isArray(x) ? x[0] : x))
    .filter(Boolean)
    .map(o => ({
      conta: String(o.conta ?? ''),
      descricao: String(o.descricaocomcontacategoria ?? o.descricao ?? '').trim(),
      valor: parseFloat(o.valor ?? 0) || 0,
      natureza: String(o.natureza ?? ''),
      porcento: parseFloat(o.porcento ?? 0) || 0,
    }));
  return { nomeplanocontas: bloco?.nomeplanocontas || '', itens };
}

// ⚠️ GOTCHA CRÍTICO: orcamentos/index IGNORA idCondominio — devolve SEMPRE o orçamento do
// condomínio DEFAULT da licença (nesta conta NCS = 179/Lume), como o arquivos/index faz com as ATAs.
// A previsão orçamentária POR condomínio só existe no relatório W025A (relatorios/id/025A), que é um
// pipeline de PDF (getId → HTML renderizado), sem JSON estruturado utilizável.
// => Só devolvemos o orçamento quando o condo pedido É o default confiável; senão [] (relatório sem previsão).
const ORC_DEFAULT_CONDO = process.env.ORCAMENTO_DEFAULT_CONDO ? Number(process.env.ORCAMENTO_DEFAULT_CONDO) : 179;
export async function orcamento(idCondominio) {
  if (Number(idCondominio) !== ORC_DEFAULT_CONDO) return []; // evita mostrar previsão de OUTRO condo (silent failure)
  const raw = await slGet('orcamentos/index', { idCondominio });
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map(r => {
    const valorMes = {};
    for (let m = 0; m <= 12; m++) {
      const v = r['valor_' + m];
      if (v !== undefined && v !== '') valorMes[m] = parseFloat(v) || 0;
    }
    return {
      conta: String(r.conta ?? '').trim(),
      descricao: String(r.descricaosemcomplemento ?? r.descricao ?? '').trim(),
      nivel: Number(r.nivel ?? 0),
      valorMes, // { 1:.., 2:.., ... 12:.. }  (mês 0 = total anual, quando presente)
    };
  }).filter(r => r.conta);
}

// caixa/index → movimentos com saldo inicial na 1ª linha
export async function caixa(idCondominio, dtInicio, dtFim) {
  const raw = await slGet('caixa/index', { idCondominio, dtInicio, dtFim, tipoFiltroData: 'periodo' });
  return Array.isArray(raw) ? raw : [];
}

// contabancos/index → saldo por conta bancária (WHITELIST — nunca devolve tokens/secrets)
const CB_WHITELIST = ['id_contabanco_cb', 'st_nome_banc', 'st_numero_banc', 'st_descricao_cb', 'st_conta_cb', 'vl_saldo_cb', 'fl_principal_cb', 'nm_ordem_cb'];
export async function contasBancarias(idCondominio) {
  const raw = await slGet('contabancos/index', { idCondominio, exibirContasAtivas: 1 });
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map(c => {
    const out = {};
    for (const k of CB_WHITELIST) out[k] = c[k];
    out.saldo = parseFloat(c.vl_saldo_cb ?? 0) || 0;
    return out;
  });
}

// inadimplencia resumo → só agregação (conta + soma); descarta PII do detalhe
export async function inadimplenciaResumo(idCondominio) {
  const raw = await slGet('inadimplencia/index', { idCondominio, apenasResumoInad: 1 });
  const arr = Array.isArray(raw) ? raw : [];
  const unidades = arr.map(u => ({
    unidade: `${String(u.st_bloco_uni ?? '').trim()} ${String(u.st_unidade_uni ?? '').trim()}`.trim(),
    valor: parseFloat(u.total_original ?? 0) || 0,
    cobrancas: Number(u.qtd_cobrancas_em_aberto ?? 0),
    juridico: Array.isArray(u.processos) && u.processos.length > 0,
  }));
  const total = unidades.reduce((s, u) => s + u.valor, 0);
  return { qtd: unidades.length, total, unidades };
}

export { slGet };
