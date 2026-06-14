// superlogica.mjs — tools de LEITURA reais (endpoints validados no live-map 11/06).
// SOMENTE GET. Whitelist de campos (PII/cartão nunca saem). Cache da lista de condomínios.
import { config } from './config.mjs';

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
  const data = await slGet('cobranca/index', { idCondominio: id_condominio, status: 'pendentes', 'UNIDADES[0]': id_unidade });
  const itens = (Array.isArray(data) ? data : []).filter((b) => String(b.id_unidade_uni) === String(id_unidade)); // anti-troca
  if (!itens.length) return { liberado: false, motivo: 'nenhum boleto pendente para esta unidade' };
  const b = itens.sort((a, z) => new Date(a.dt_vencimento_recb) - new Date(z.dt_vencimento_recb))[0];
  const diasVencido = b.dt_vencimento_recb ? Math.floor((Date.now() - new Date(b.dt_vencimento_recb)) / 86400000) : 0;
  if (diasVencido > 30) return { liberado: false, dias_vencido: diasVencido, motivo: 'boleto vencido +30 dias — encaminhar à cobrança' };
  return {
    liberado: true, dias_vencido: diasVencido,
    id_unidade_uni: b.id_unidade_uni,
    st_pixqrcode_recb: b.st_pixqrcode_recb || null,
    link_segundavia: b.link_segundavia || null,
    vl_total_recb: b.vl_total_recb,
    dt_vencimento_recb: b.dt_vencimento_recb,
  };
}

export async function get_inadimplencia({ id_condominio, id_unidade } = {}) {
  const data = await slGet('cobranca/index', { idCondominio: id_condominio, status: 'pendentes', 'UNIDADES[0]': id_unidade });
  const itens = (Array.isArray(data) ? data : []).filter((b) => String(b.id_unidade_uni) === String(id_unidade));
  const vencidos = itens.filter((b) => b.fl_inadimplente_recb == 1 || b.fl_inadimplente_recb === true);
  return vencidos.length ? { status: 'inadimplente', qtd: vencidos.length } : { status: 'adimplente' };
}
