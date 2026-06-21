// superlogica.mjs — tools de LEITURA reais (endpoints validados no live-map 11/06).
// SOMENTE GET. Whitelist de campos (PII/cartão nunca saem). Cache da lista de condomínios.
import { config } from './config.mjs';
import { consultar_garantidora } from './garantidora.mjs';

// garantidoraDe: resolve a garantidora do condomínio por id; tenta o nome (cache) como reforço de match.
async function garantidoraDe(id_condominio) {
  let nome = null;
  try { const condos = await listCondominios(); nome = (condos.find((c) => String(c.id) === String(id_condominio)) || {}).nome; } catch { /* sem cache → casa por id mesmo */ }
  const g = consultar_garantidora({ id_condominio, nome });
  return g.tem ? g : null;
}

async function slGet(controllerAction, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${config.slBase}/${controllerAction}${qs ? '?' + qs : ''}`;
  const r = await fetch(url, { headers: { app_token: config.slApp, access_token: config.slAccess, 'Content-Type': 'application/json' } });
  if (!r.ok) throw new Error(`Superlógica ${controllerAction} ${r.status}`);
  return r.json();
}

let _condosCache = null;
async function listCondominios() {
  if (_condosCache) return _condosCache;
  const data = await slGet('condominios/get', { id: -1 });
  _condosCache = (Array.isArray(data) ? data : []).map((c) => ({ id: c.id_condominio_cond || c.id, nome: c.st_fantasia_cond || c.st_nome_cond || '' }));
  return _condosCache;
}

// _match: função PURA (testável) — dado um responsável e os critérios de busca, devolve {criterio, score} ou null.
// Ordem de confiança: CPF (própria pessoa) > telefone (número do titular) > nome (homônimo possível → confirmar).
const _digits = (s) => (s || '').replace(/\D/g, '');
const _normNome = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
export function _match(r, { cpfd, telTail, nomeN }) {
  if (cpfd && _digits(r.st_cpf_con) === cpfd) return { criterio: 'cpf', score: 100 };
  if (telTail) { const rt = _digits(r.st_telefone_con); if (rt.length >= 8 && rt.slice(-8) === telTail) return { criterio: 'telefone', score: 80 }; }
  if (nomeN) {
    const rn = _normNome(r.st_nome_con);
    if (rn === nomeN) return { criterio: 'nome_exato', score: 60 };
    const toks = nomeN.split(' ').filter((t) => t.length >= 3);
    if (toks.length >= 2 && toks.every((t) => rn.includes(t))) return { criterio: 'nome_completo', score: 50 };
    if (rn.includes(nomeN) || nomeN.includes(rn)) return { criterio: 'nome_parcial', score: 30 };
  }
  return null;
}

// resolver_cadastro: identidade por CPF, telefone do titular (do canal) ou nome+condomínio.
// Retorna { encontrado, criterio, confianca, unidades:[{id_unidade, identificacao, condominio, id_condominio, papel, nome, ex_morador}] }
// ou { encontrado:false, motivo }. confianca alta=cpf/telefone (própria pessoa); media/baixa=nome → o agente CONFIRMA antes de entregar dado sensível (LGPD).
export async function resolver_cadastro({ cpf, nome, condominio, telefone } = {}) {
  const cpfd = _digits(cpf);
  const teld = _digits(telefone);
  const telTail = teld.length >= 8 ? teld.slice(-8) : null;
  const nomeN = _normNome(nome);
  if (!cpfd && !telTail && !nomeN) return { encontrado: false, motivo: 'sem_criterio' };
  // busca SÓ por nome sem condomínio é proibida (homônimos espalhados em 54 condos) → exige o condomínio.
  if (!cpfd && !telTail && nomeN && !condominio) return { encontrado: false, motivo: 'nome_exige_condominio' };

  let condos = await listCondominios();
  if (condominio) {
    const alvo = condos.filter((c) => c.nome.toLowerCase().includes(String(condominio).toLowerCase()));
    if (alvo.length) condos = alvo;
  }

  const q = { cpfd, telTail, nomeN };
  const matches = [];
  const CONC = 8;
  async function scan(c) {
    let resp; try { resp = await slGet('responsaveis/index', { idCondominio: c.id }); } catch { return; }
    for (const r of (Array.isArray(resp) ? resp : [])) {
      const m = _match(r, q);
      if (m) matches.push({ ...m, unidade: {
        id_unidade: r.id_unidade_uni,
        identificacao: [r.st_bloco_uni, r.st_unidade_uni].map((s) => (s || '').trim()).filter(Boolean).join(' / ') || String(r.id_unidade_uni),
        condominio: c.nome, id_condominio: c.id,
        papel: r.id_label_tres, papel_nome: r.st_nometiporesp_tres || null,
        nome: r.st_nome_con, ex_morador: !!(r.dt_saida_res && String(r.dt_saida_res).trim()),
      } });
    }
  }
  // condomínio informado = 1 lote; senão varre em lotes e para ao achar match forte (cpf/telefone).
  for (let i = 0; i < condos.length; i += CONC) {
    await Promise.all(condos.slice(i, i + CONC).map(scan));
    if (condominio || matches.some((m) => m.score >= 80)) break;
  }
  if (!matches.length) return { encontrado: false, unidades: [], motivo: (cpfd ? 'cpf' : telTail ? 'telefone' : 'nome') + '_nao_encontrado' };

  const best = Math.max(...matches.map((m) => m.score));
  const criterio = matches.find((m) => m.score === best).criterio;
  const confianca = best >= 80 ? 'alta' : best >= 50 ? 'media' : 'baixa';
  const seen = new Set(); const unidades = [];
  for (const m of matches.filter((m) => m.score === best)) {
    const k = `${m.unidade.id_condominio}:${m.unidade.id_unidade}`;
    if (!seen.has(k)) { seen.add(k); unidades.push(m.unidade); }
  }
  return { encontrado: true, criterio, confianca, unidades };
}

// get_boleto_2via: cobranca/index?status=pendentes&UNIDADES[0]=<id>  → PIX copia-e-cola + link.
// ATENÇÃO: idUnidade é ignorado; o filtro é UNIDADES[0]=. Conferir id_unidade_uni no retorno (LGPD).
export async function get_boleto_2via({ id_condominio, id_unidade } = {}) {
  if (!id_condominio || !id_unidade) return { erro: 'faltam id_condominio e id_unidade' };
  // Garantidora 'total': a NCS não gera boleto pelo Superlógica → direcionar à garantidora (nem consulta o sistema).
  const gar = await garantidoraDe(id_condominio);
  if (gar && gar.tipo === 'total') return { liberado: false, motivo: 'garantidora', garantidora: gar.garantidora };
  const data = await slGet('cobranca/index', { idCondominio: id_condominio, status: 'pendentes', 'UNIDADES[0]': id_unidade });
  const itens = (Array.isArray(data) ? data : []).filter((b) => String(b.id_unidade_uni) === String(id_unidade)); // anti-troca
  if (!itens.length) return { liberado: false, motivo: 'nenhum boleto pendente para esta unidade' };
  const b = itens.sort((a, z) => new Date(a.dt_vencimento_recb) - new Date(z.dt_vencimento_recb))[0];
  const diasVencido = b.dt_vencimento_recb ? Math.floor((Date.now() - new Date(b.dt_vencimento_recb)) / 86400000) : 0;
  if (diasVencido > 30) {
    const r = { liberado: false, dias_vencido: diasVencido, motivo: 'boleto vencido +30 dias — encaminhar à cobrança' };
    if (gar && gar.tipo === 'allure') r.garantidora = gar.garantidora; // Allure: inadimplência +31d é da Inadimplência Zero.
    return r;
  }
  return {
    liberado: true, dias_vencido: diasVencido,
    id_unidade_uni: b.id_unidade_uni,
    st_pixqrcode_recb: b.st_pixqrcode_recb || null,
    link_segundavia: b.link_segundavia || null,
    vl_total_recb: b.vl_total_recb,
    dt_vencimento_recb: b.dt_vencimento_recb,
  };
}

// get_boleto_pdf_url: deriva a URL do PDF da 2ª via (link_segundavia com FaturaHtml→FaturaPdf — validado em
// .tmp/test_link_pdf.js: FaturaPdf entrega application/pdf real ~360KB, URL pública; render=pdf NÃO funciona).
// Reusa get_boleto_2via → mesma seleção do boleto + guards (garantidora 'total', vencido +30 dias). NÃO baixa nem
// envia: só devolve a URL + dados (o download/envio fica no octadesk.mjs). Anti-troca já garantido pelo get_boleto_2via.
export async function get_boleto_pdf_url({ id_condominio, id_unidade } = {}) {
  const b = await get_boleto_2via({ id_condominio, id_unidade });
  if (!b.liberado || !b.link_segundavia) {
    return { ok: false, motivo: b.motivo || 'sem_boleto', ...(b.garantidora ? { garantidora: b.garantidora } : {}) };
  }
  const pdf_url = b.link_segundavia.replace(/FaturaHtml/i, 'FaturaPdf');
  if (!/FaturaPdf/i.test(pdf_url)) return { ok: false, motivo: 'url_pdf_indisponivel' };
  const venc = String(b.dt_vencimento_recb || '').replace(/[^0-9A-Za-z]/g, '-');
  return {
    ok: true, pdf_url, filename: `boleto-${venc || 'segundavia'}.pdf`,
    id_unidade_uni: b.id_unidade_uni, vencimento: b.dt_vencimento_recb, valor: b.vl_total_recb,
  };
}

// get_inadimplencia: situação COMPLETA de débitos da unidade — usa `inadimplencia/index` (enxerga boletos ANTIGOS,
// em cobrança e jurídico), NÃO só os recentes do `cobranca/index?status=pendentes` (esse era o PONTO CEGO que fazia a
// Ana afirmar "só deve esse boleto" para quem devia dezenas de milhares). ⚠️ idUnidade é ignorado → filtro = UNIDADES[0]=.
// Validado 21/06: ABV (191) tem 74 inadimplentes / R$457k; campos por unidade = qtd_cobrancas_em_aberto + total_original.
// Retorna { status: 'inadimplente' (+qtd_cobrancas_em_aberto) | 'sem_debito_vencido' | 'gerido_por_garantidora' | 'indisponivel' }.
export async function get_inadimplencia({ id_condominio, id_unidade } = {}) {
  const gar = await garantidoraDe(id_condominio);
  if (gar && gar.tipo === 'total') return { status: 'gerido_por_garantidora', garantidora: gar.garantidora };
  let data;
  try { data = await slGet('inadimplencia/index', { idCondominio: id_condominio, apenasResumoInad: 1, 'UNIDADES[0]': id_unidade }); }
  catch { return { status: 'indisponivel' }; } // erro na consulta → NÃO cravar adimplência; a Ana oferece humano/CND
  const linhas = (Array.isArray(data) ? data : []).filter((u) => String(u.id_unidade_uni) === String(id_unidade)); // anti-troca
  if (linhas.length) {
    const qtd = Number(linhas[0].qtd_cobrancas_em_aberto) || null;
    const r = { status: 'inadimplente', qtd_cobrancas_em_aberto: qtd };
    if (gar && gar.tipo === 'allure') r.garantidora = gar.garantidora; // Allure: cobrança pela Inadimplência Zero.
    return r;
  }
  return { status: 'sem_debito_vencido' }; // não consta na inadimplência (pode ter boleto A VENCER → get_boleto_2via)
}
