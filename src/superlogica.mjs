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

// Timeout (env SL_TIMEOUT_MS, default 20s): sem isto um request lento da Superlógica trava o turno inteiro p/ sempre
// (→ "parou de responder" no Chatwoot). Com AbortSignal.timeout, vira erro tratável (o agente compõe "não consegui consultar agora").
const SL_TIMEOUT_MS = Number(process.env.SL_TIMEOUT_MS || 20000);
async function slGet(controllerAction, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${config.slBase}/${controllerAction}${qs ? '?' + qs : ''}`;
  const r = await fetch(url, { headers: { app_token: config.slApp, access_token: config.slAccess, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(SL_TIMEOUT_MS) });
  if (!r.ok) throw new Error(`Superlógica ${controllerAction} ${r.status}`);
  return r.json();
}

// _unidadeNoJuridico: a unidade está em PROCESSO JUDICIAL? Só a variante de `inadimplencia/index` SEM `apenasResumoInad`
// traz o array `processos[]` (validado 22/06: ABV 191 u16394 → processos[0].fl_status_proc=6, e o link PÚBLICO da 2ª via
// recusa "a unidade está no jurídico"). ⚠️ `fl_statusfin_uni=10` é "em cobrança/negativado" — MAIS amplo que jurídico
// (há unidade com 10 e SEM processo) → NÃO serve de sinal; usamos `processos[]`. Conservador: qualquer processo presente
// conta como jurídico (errar para o lado de encaminhar à cobrança é seguro; o oposto = risco jurídico). idUnidade ignorado → UNIDADES[0]=.
// Em erro de consulta NÃO bloqueia (no_juridico:false) — o +30d/garantidora ainda protegem e o jurídico é a exceção.
async function _unidadeNoJuridico({ id_condominio, id_unidade }) {
  let data;
  try { data = await slGet('inadimplencia/index', { idCondominio: id_condominio, 'UNIDADES[0]': id_unidade }); }
  catch { return { erro: true, no_juridico: false }; }
  const row = (Array.isArray(data) ? data : []).find((u) => String(u.id_unidade_uni) === String(id_unidade));
  const qtd = Array.isArray(row?.processos) ? row.processos.length : 0;
  return { no_juridico: qtd > 0, qtd_processos: qtd };
}

let _condosCache = null;
async function listCondominios() {
  if (_condosCache) return _condosCache;
  const data = await slGet('condominios/get', { id: -1 });
  _condosCache = (Array.isArray(data) ? data : []).map((c) => ({ id: c.id_condominio_cond || c.id, nome: c.st_fantasia_cond || c.st_nome_cond || '' }));
  return _condosCache;
}

// _match: função PURA (testável) — dado um responsável e os critérios de busca, devolve {criterio, score} ou null.
// Ordem de confiança: CPF > UNIDADE+NOME (apto restringe + nome confirma) > telefone > nome (homônimo → confirmar).
const _digits = (s) => (s || '').replace(/\D/g, '');
const _normNome = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
const _normUni = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

// _parseUnidade: extrai { num, bloco } de texto livre ("Ap. 111 Torre 2", "apto 142", "Bloco 7 apartamento 401", "unidade 506").
// num = número do apartamento/unidade (dígitos); bloco = torre/bloco/quadra (sem rótulo). Retorna null se não houver número.
export function _parseUnidade(u) {
  if (!u) return null;
  const s = String(u);
  let num = null, bloco = null;
  let m = s.match(/\b(?:ap(?:arta?mento)?|apto|unidade|casa|sala|loja|n[ºo]\.?)\s*\.?\s*(\d{1,5})/i);
  if (m) num = m[1];
  m = s.match(/\b(?:bl(?:oco)?|torre|quadra|t)\s*\.?\s*([a-z0-9]{1,4})\b/i);
  if (m) bloco = m[1].toLowerCase();
  if (!num) { // sem rótulo de apto: pega o 1º número que não seja o do bloco
    const nums = [...s.matchAll(/\b(\d{1,5})\b/g)].map((x) => x[1]);
    num = nums.find((n) => n !== bloco) || null;
  }
  return num ? { num, bloco: bloco || null } : null;
}

export function _match(r, { cpfd, telTail, nomeN, unidadeQ }) {
  const cands = [];
  if (cpfd && _digits(r.st_cpf_con) === cpfd) cands.push({ criterio: 'cpf', score: 100 });
  // UNIDADE + NOME: identificação forte e segura sem CPF (a unidade restringe a 1-3 pessoas; o nome confirma).
  if (unidadeQ?.num) {
    const ruNum = _digits(r.st_unidade_uni);
    if (ruNum && ruNum === unidadeQ.num) {
      const rb = _normUni(r.st_bloco_uni);
      const blocoOk = !unidadeQ.bloco || (rb && (rb.includes(unidadeQ.bloco) || unidadeQ.bloco.includes(rb)));
      let nomeOk = false;
      if (nomeN) {
        const rn = _normNome(r.st_nome_con);
        const toks = nomeN.split(' ').filter((t) => t.length >= 3);
        nomeOk = rn === nomeN || (toks.length >= 1 && toks.some((t) => rn.includes(t)));
      }
      if (nomeOk) cands.push({ criterio: 'unidade_nome', score: blocoOk ? 88 : 82 });
      else cands.push({ criterio: 'unidade_fraca', score: 35 }); // só a unidade casa → sinal fraco, NÃO libera sozinho (LGPD)
    }
  }
  if (telTail) { const rt = _digits(r.st_telefone_con); if (rt.length >= 8 && rt.slice(-8) === telTail) cands.push({ criterio: 'telefone', score: 80 }); }
  if (nomeN) {
    const rn = _normNome(r.st_nome_con);
    if (rn === nomeN) cands.push({ criterio: 'nome_exato', score: 60 });
    else {
      const toks = nomeN.split(' ').filter((t) => t.length >= 3);
      if (toks.length >= 2 && toks.every((t) => rn.includes(t))) cands.push({ criterio: 'nome_completo', score: 50 });
      else if (rn.includes(nomeN) || nomeN.includes(rn)) cands.push({ criterio: 'nome_parcial', score: 30 });
    }
  }
  if (!cands.length) return null;
  return cands.sort((a, b) => b.score - a.score)[0];
}

// resolver_cadastro: identidade por CPF, telefone do titular (do canal) ou nome+condomínio.
// Retorna { encontrado, criterio, confianca, unidades:[{id_unidade, identificacao, condominio, id_condominio, papel, nome, ex_morador}] }
// ou { encontrado:false, motivo }. confianca alta=cpf/telefone (própria pessoa); media/baixa=nome → o agente CONFIRMA antes de entregar dado sensível (LGPD).
// deps = injeção só para teste (fixture sem API/PII). Produção não passa nada → usa o real.
export async function resolver_cadastro({ cpf, nome, condominio, telefone, unidade } = {}, deps = {}) {
  const cpfd = _digits(cpf);
  const teld = _digits(telefone);
  const telTail = teld.length >= 8 ? teld.slice(-8) : null;
  const nomeN = _normNome(nome);
  const unidadeQ = _parseUnidade(unidade);
  if (!cpfd && !telTail && !nomeN && !unidadeQ) return { encontrado: false, motivo: 'sem_criterio' };
  // busca SÓ por nome/unidade sem condomínio é proibida (homônimos/aptos repetidos em 54 condos) → exige o condomínio.
  if (!cpfd && !telTail && (nomeN || unidadeQ) && !condominio) return { encontrado: false, motivo: 'nome_exige_condominio' };

  const _listCondominios = deps.listCondominios || listCondominios;
  const _slGet = deps.slGet || slGet;

  let condos = await _listCondominios();
  if (condominio) {
    const alvo = condos.filter((c) => c.nome.toLowerCase().includes(String(condominio).toLowerCase()));
    if (alvo.length) condos = alvo;
  }

  const q = { cpfd, telTail, nomeN, unidadeQ };
  const matches = [];
  // 30 = 2 rodadas nos ~59 condomínios. Medido contra a API real (15/07): 8→22,2s · 16→11,8s ·
  // 30→8,4s · 59→6,4s, ZERO erro em todos. Ficou mais rápido que os 22s que a busca por CPF
  // não-encontrado já custava. Teto fixo (não 59) p/ não escalar sozinho conforme a base cresce.
  const CONC = 30;
  async function scan(c) {
    let resp; try { resp = await _slGet('responsaveis/index', { idCondominio: c.id }); } catch { return; }
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
  // Varre TODOS os condomínios do escopo antes de decidir.
  // ⚠️ Havia um `break` ao achar match forte ("achei o CPF, pronto") — a premissa "1 CPF = 1
  // condomínio" é FALSA: 207 CPFs da base têm unidade em 2+ condomínios e 181 deles tinham a
  // segunda FORA do 1º lote de 8 → a Ana entregava um boleto e era cega ao outro, calada.
  // Quando o condomínio é informado, `condos` já vem filtrado acima → continua barato (1 rodada).
  for (let i = 0; i < condos.length; i += CONC) {
    await Promise.all(condos.slice(i, i + CONC).map(scan));
  }
  if (!matches.length) return { encontrado: false, unidades: [], motivo: (cpfd ? 'cpf' : telTail ? 'telefone' : (unidadeQ && !nomeN) ? 'unidade' : 'nome') + '_nao_encontrado' };

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

// decidirSemBoleto: quando o cobranca/index?status=pendentes NÃO retorna boleto na janela de ~30d,
// o get_boleto_2via cruza com a inadimplência COMPLETA (get_inadimplencia, que enxerga os ANTIGOS) e
// decide a mensagem — distinguindo "dívida antiga fora da janela" de "realmente sem débito". Pura/
// testável (test_boleto_sem_janela.mjs). ⚠️ Regra do Fernando (23/07, caso Vanessa): sem boleto na
// janela NÃO é "está em dia" — se há débito antigo, encaminhe à COBRANÇA e NUNCA diga "jurídico"
// (o Tívoli, p.ex., deixa até 90d sem ir ao jurídico). O `mensagem_morador` é o texto fixo que o
// LLM só repassa (não compõe) — evita o "não localizei na emissão automática" que a moradora leu
// como "não devo nada". `no_juridico` volta só p/ o roteamento interno do time, nunca ao morador.
export function decidirSemBoleto(inad) {
  if (inad?.status === 'inadimplente') {
    return {
      liberado: false, motivo: 'debito_fora_da_janela_30d',
      qtd_cobrancas_em_aberto: inad.qtd_cobrancas_em_aberto ?? null,
      ...(inad.no_juridico ? { no_juridico: true } : {}),
      ...(inad.qtd_processos ? { qtd_processos: inad.qtd_processos } : {}),
      ...(inad.garantidora ? { garantidora: inad.garantidora } : {}),
      mensagem_morador:
        'Há valor(es) vencido(s) há mais de 30 dias. A emissão automática da 2ª via cobre apenas os ' +
        'últimos 30 dias do vencimento, então preciso encaminhar à equipe de cobrança para a conferência.',
    };
  }
  if (inad?.status === 'gerido_por_garantidora') {
    return { liberado: false, motivo: 'garantidora', garantidora: inad.garantidora };
  }
  // sem_debito_vencido | indisponivel | null → não cravar quitação; convidar a informar o mês/competência.
  return {
    liberado: false, motivo: 'sem_boleto_na_janela',
    mensagem_morador:
      'Não localizei boleto em aberto ou a vencer nos próximos dias para essa unidade. Se você esperava ' +
      'algum, me diga o mês/competência que eu verifico melhor.',
  };
}

// get_boleto_2via: cobranca/index?status=pendentes&UNIDADES[0]=<id>  → PIX copia-e-cola + link.
// ATENÇÃO: idUnidade é ignorado; o filtro é UNIDADES[0]=. Conferir id_unidade_uni no retorno (LGPD).
export async function get_boleto_2via({ id_condominio, id_unidade } = {}) {
  if (!id_condominio || !id_unidade) return { erro: 'faltam id_condominio e id_unidade' };
  // Garantidora 'total': a NCS não gera boleto pelo Superlógica → direcionar à garantidora (nem consulta o sistema).
  const gar = await garantidoraDe(id_condominio);
  if (gar && gar.tipo === 'total') return { liberado: false, motivo: 'garantidora', garantidora: gar.garantidora };
  // Unidade em PROCESSO JUDICIAL: o Superlógica BLOQUEIA a 2ª via pública ("a unidade está no jurídico") e pagar uma
  // mensalidade avulsa não quita o débito em processo → encaminhar à cobrança, NUNCA self-service. (Em paralelo com a cobrança.)
  const [jur, data] = await Promise.all([
    _unidadeNoJuridico({ id_condominio, id_unidade }),
    slGet('cobranca/index', { idCondominio: id_condominio, status: 'pendentes', 'UNIDADES[0]': id_unidade }),
  ]);
  if (jur.no_juridico) return { liberado: false, motivo: 'unidade_no_juridico', qtd_processos: jur.qtd_processos };
  const itens = (Array.isArray(data) ? data : []).filter((b) => String(b.id_unidade_uni) === String(id_unidade)); // anti-troca
  // Sem boleto na janela dos ~30d: NÃO conclua "está em dia". Cruza com a inadimplência completa
  // (enxerga os antigos/jurídico) e devolve a mensagem certa — nunca "não localizei" p/ quem deve.
  if (!itens.length) return decidirSemBoleto(await get_inadimplencia({ id_condominio, id_unidade }));
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

// responsaveis/index IGNORA idUnidade e devolve o condomínio inteiro → sempre filtrar.
export function filtrarPorUnidade(lista, idUnidade) {
  const alvo = String(idUnidade);
  return (Array.isArray(lista) ? lista : []).filter((x) => String(x.id_unidade_uni) === alvo);
}

export async function responsaveisIndex(idCondominio, idUnidade) {
  const data = await slGet('responsaveis/index', { idCondominio });
  const lista = Array.isArray(data) ? data : (data?.data || data?.registros || []);
  return idUnidade != null ? filtrarPorUnidade(lista, idUnidade) : lista;
}

// get_inadimplencia: situação COMPLETA de débitos da unidade — usa `inadimplencia/index` (enxerga boletos ANTIGOS,
// em cobrança e jurídico), NÃO só os recentes do `cobranca/index?status=pendentes` (esse era o PONTO CEGO que fazia a
// Ana afirmar "só deve esse boleto" para quem devia dezenas de milhares). ⚠️ idUnidade é ignorado → filtro = UNIDADES[0]=.
// Validado 21/06: ABV (191) tem 74 inadimplentes / R$457k; campos por unidade = qtd_cobrancas_em_aberto + total_original.
// Retorna { status: 'inadimplente' (+qtd_cobrancas_em_aberto, +no_juridico/qtd_processos) | 'sem_debito_vencido' | 'gerido_por_garantidora' | 'indisponivel' }.
// no_juridico:true = a unidade tem processo judicial aberto (a 2ª via self-service fica bloqueada → cobrança).
export async function get_inadimplencia({ id_condominio, id_unidade } = {}) {
  const gar = await garantidoraDe(id_condominio);
  if (gar && gar.tipo === 'total') return { status: 'gerido_por_garantidora', garantidora: gar.garantidora };
  let data;
  try { data = await slGet('inadimplencia/index', { idCondominio: id_condominio, apenasResumoInad: 1, 'UNIDADES[0]': id_unidade }); }
  catch { return { status: 'indisponivel' }; } // erro na consulta → NÃO cravar adimplência; a Ana oferece humano/CND
  const linhas = (Array.isArray(data) ? data : []).filter((u) => String(u.id_unidade_uni) === String(id_unidade)); // anti-troca
  if (linhas.length) {
    const qtd = Number(linhas[0].qtd_cobrancas_em_aberto) || null;
    // no_juridico: a unidade tem processo judicial aberto? Só checa o processo (1 chamada extra) quando há status
    // financeiro especial — `fl_statusfin_uni` vazio NUNCA tem processo (validado 22/06). Evita a chamada no caso comum.
    let jur = { no_juridico: false };
    if (String(linhas[0].fl_statusfin_uni || '').trim()) jur = await _unidadeNoJuridico({ id_condominio, id_unidade });
    const r = { status: 'inadimplente', qtd_cobrancas_em_aberto: qtd, no_juridico: !!jur.no_juridico, ...(jur.qtd_processos ? { qtd_processos: jur.qtd_processos } : {}) };
    if (gar && gar.tipo === 'allure') r.garantidora = gar.garantidora; // Allure: cobrança pela Inadimplência Zero.
    return r;
  }
  return { status: 'sem_debito_vencido' }; // não consta na inadimplência (pode ter boleto A VENCER → get_boleto_2via)
}
