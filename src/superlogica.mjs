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

// resolver_cadastro: acha a(s) unidade(s) por CPF. Busca em responsaveis/index por condomínio.
// Se condominio informado, busca só nele; senão varre (cap) — o resolver de identidade robusto é a Fase 1.
export async function resolver_cadastro({ cpf, condominio } = {}) {
  const onlyDigits = (s) => (s || '').replace(/\D/g, '');
  const cpfd = onlyDigits(cpf);
  if (!cpfd) return { encontrado: false, motivo: 'sem cpf' };
  let condos = await listCondominios();
  if (condominio) {
    const alvo = condos.filter((c) => c.nome.toLowerCase().includes(String(condominio).toLowerCase()));
    if (alvo.length) condos = alvo;
  }
  const unidades = [];
  const CONC = 8;
  async function scan(c) {
    let resp; try { resp = await slGet('responsaveis/index', { idCondominio: c.id }); } catch { return; }
    for (const r of (Array.isArray(resp) ? resp : [])) {
      if (onlyDigits(r.st_cpf_con) === cpfd) unidades.push({ id_unidade: r.id_unidade_uni || r.id_unidade, condominio: c.nome, id_condominio: c.id, papel: r.id_label_tres, nome: r.st_nome_con });
    }
  }
  // busca em LOTES PARALELOS (não um a um) — para cedo assim que acha. Condomínio informado = 1 lote.
  for (let i = 0; i < condos.length && !unidades.length; i += CONC) {
    await Promise.all(condos.slice(i, i + CONC).map(scan));
    if (condominio) break;
  }
  return unidades.length ? { encontrado: true, unidades } : { encontrado: false, unidades: [] };
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
