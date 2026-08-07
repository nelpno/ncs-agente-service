// superlogica.mjs — tools de LEITURA reais (endpoints validados no live-map 11/06).
// SOMENTE GET. Whitelist de campos (PII/cartão nunca saem). Cache da lista de condomínios.
import { config } from './config.mjs';
import { consultar_garantidora } from './garantidora.mjs';
import { buscarPorCpf } from './pessoas.mjs';
// mesma regra de casamento de nome que o Estagiário/gerador já usa (normNome tira acento; tokensNome
// descarta "condomínio/residencial/edifício/de/do..."). Uma regra só para os dois lados: quando a Ana
// e o gerador divergem em como leem o nome do condomínio, o pedido morre no meio do caminho.
import { normNome, tokensNome, casaPorTokens } from '../gerador/src/match-nome.mjs';

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
// "051" e "51" são o mesmo apartamento dito de dois jeitos; "000" não pode virar string vazia.
const _semZeros = (s) => String(s || '').replace(/^0+/, '') || '0';

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

// _filtrarCondos: reduz a varredura ao(s) condomínio(s) que a pessoa nomeou.
//
// ESCADA de 4 degraus, cada um só se o anterior deu vazio — assim nada que já casava muda de
// resultado. Medido em 29/07/2026: 12 dos 55 nomes das nossas próprias bases não casavam pelo
// degrau 1 (o único que existia), e sem match a busca varria os 59 condomínios: a mesma unidade
// "051" existe em 9 prédios, então voltavam candidatos de outros condomínios na mesma resposta.
//   1. substring SEM ACENTO, em fronteira de palavra → "Jatiuca" acha "Jatiúca"; "Pairas", "PAIRÁS"
//   2. todas as palavras significativas → "Condomínio Vancouver" acha "CONDOMINIO RESIDENCIAL
//      VANCOUVER" (a palavra do meio atravessava a substring)
//   3. as mesmas palavras no singular → "Rosas de Ouro" acha "ROSA DE OURO"
//   4. prefixo de palavra → "CDHU" acha "CDHU1"
// Pino de não-regressão sobre os 59 nomes reais: 47 consultas idênticas, 8 melhoraram, 0 degradaram,
// 0 colisões novas entre condomínios distintos.
//
// ⚠️ Exigir TODAS as palavras (e não "alguma") é o que preserva a ambiguidade legítima: "Cedros"
// continua devolvendo Vistas do Botânico - Cedros E Cedros do Campo, para a pessoa escolher. Um
// filtro que "acerta" escolhendo um dos dois já quebrou um condomínio em silêncio aqui.
// Nenhum degrau casou → devolve TODOS (busca ampla, o comportamento de sempre), nunca vazio.
export function _filtrarCondos(condos, condominio) {
  if (!condominio) return condos;
  const alvoToks = tokensNome(condominio);
  if (!alvoToks.length) return condos; // só palavra estrutural ("condomínio") não identifica ninguém

  // ⚠️ substring em FRONTEIRA DE PALAVRA (os espaços nas pontas). Sem isso, "…SALTO GRANDE I" casa
  // dentro de "…SALTO GRANDE III" — condomínios diferentes, com síndico e boleto diferentes. Antes
  // do fix quem os separava era o acento de "ASSOCIAÇÃO", por acidente; ao tirar o acento eles
  // colidiram. Pego por um pino de não-regressão rodado sobre os 59 nomes reais.
  const q = ` ${normNome(condominio)} `;
  const porSubstring = condos.filter((c) => ` ${normNome(c.nome)} `.includes(q));
  if (porSubstring.length) return porSubstring;

  const porTokens = condos.filter((c) => casaPorTokens(alvoToks, [c.nome]));
  if (porTokens.length) return porTokens;

  const sing = (ts) => ts.map((t) => (t.length > 3 ? t.replace(/s$/, '') : t));
  const alvoSing = sing(alvoToks);
  const porSingular = condos.filter((c) => {
    const disp = new Set(sing(tokensNome(c.nome)));
    return alvoSing.every((t) => disp.has(t));
  });
  if (porSingular.length) return porSingular;

  // ÚLTIMO degrau — prefixo de palavra: a equipe diz "CDHU" e o ERP grava "CDHU1" colado. Vem por
  // último de propósito: "SALTO GRANDE I" já casou lá em cima (existe literalmente), então nunca
  // chega aqui para ser arrastado pelo "SALTO GRANDE III". Mínimo de 3 letras para um fragmento
  // curto não varrer meio cadastro.
  const porPrefixo = alvoToks.every((t) => t.length >= 3)
    ? condos.filter((c) => {
      const disp = tokensNome(c.nome);
      return alvoToks.every((t) => disp.some((d) => d.startsWith(t)));
    })
    : [];
  return porPrefixo.length ? porPrefixo : condos;
}

export function _match(r, { cpfd, telTail, nomeN, unidadeQ }) {
  const cands = [];
  if (cpfd && _digits(r.st_cpf_con) === cpfd) cands.push({ criterio: 'cpf', score: 100 });
  // UNIDADE + NOME: identificação forte e segura sem CPF (a unidade restringe a 1-3 pessoas; o nome confirma).
  if (unidadeQ?.num) {
    const ruNum = _digits(r.st_unidade_uni);
    const exato = !!ruNum && ruNum === unidadeQ.num;
    // ZERO À ESQUERDA: 2.325 das 3.798 unidades (61%), em 48 dos 59 condomínios, são gravadas "051"
    // enquanto o morador diz "apartamento 51" — comparando texto puro, ele não era identificado pela
    // via unidade+nome (a via de quem não dá CPF). Vale 1 ponto MENOS que o exato de propósito:
    // `resolver_cadastro` só devolve os matches de score MÁXIMO, então, existindo a unidade exata,
    // a normalizada é descartada sozinha. É isso que mantém "10 G" e "010 G" — unidades de DONOS
    // DIFERENTES no Tivoli (164) — separadas, sem precisar de regra nova.
    const porZero = !exato && !!ruNum && _semZeros(ruNum) === _semZeros(unidadeQ.num);
    if (exato || porZero) {
      const ajuste = exato ? 0 : 1;
      const rb = _normUni(r.st_bloco_uni);
      const blocoOk = !unidadeQ.bloco || (rb && (rb.includes(unidadeQ.bloco) || unidadeQ.bloco.includes(rb)));
      let nomeOk = false;
      if (nomeN) {
        const rn = _normNome(r.st_nome_con);
        const toks = nomeN.split(' ').filter((t) => t.length >= 3);
        nomeOk = rn === nomeN || (toks.length >= 1 && toks.some((t) => rn.includes(t)));
      }
      if (nomeOk) cands.push({ criterio: 'unidade_nome', score: (blocoOk ? 88 : 82) - ajuste });
      else cands.push({ criterio: 'unidade_fraca', score: 35 - ajuste }); // só a unidade casa → sinal fraco, NÃO libera sozinho (LGPD)
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

  // ÍNDICE GLOBAL DE CPF (O(1), multi-condo): tenta o espelho `pessoas` ANTES da varredura de 59 condos.
  // Só o caminho de CPF (match exato). Miss/erro/Supabase-off → cai na varredura (nunca é caminho crítico).
  // Resolve o ponto cego "1 CPF em 2+ condomínios" que a varredura entregava calada. Ver src/pessoas.mjs.
  if (cpfd) {
    const _hit = await buscarPorCpf(cpfd, { condominio }, deps);
    if (_hit) return _hit;
  }

  const _listCondominios = deps.listCondominios || listCondominios;
  const _slGet = deps.slGet || slGet;

  const condos = _filtrarCondos(await _listCondominios(), condominio);

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
    return { liberado: false, motivo: 'garantidora', garantidora: inad.garantidora, ...(inad.nota_extra ? { nota_extra: inad.nota_extra } : {}) };
  }
  // sem_debito_vencido | indisponivel | null → não cravar quitação; convidar a informar o mês/competência.
  return {
    liberado: false, motivo: 'sem_boleto_na_janela',
    mensagem_morador:
      'Não localizei boleto em aberto ou a vencer nos próximos dias para essa unidade. Se você esperava ' +
      'algum, me diga o mês/competência que eu verifico melhor.',
  };
}

// ---------------------------------------------------------------------------
// Boleto de um MÊS específico ("quero o de julho") — buraco medido no uso real
// (06/08, conv 658 do Allure: a moradora precisava do de julho para abrir um sinistro e a
// equipe teve de mandar à mão). Sondado ao vivo em 07/08: `cobranca/index` SEM data devolve
// só o mês CORRENTE, nem com status=todos; com `filtrarpor=vencimento` + `dtInicio`/`dtFim`
// alcança qualquer mês (julho do Allure: 717 itens, 309 pagos, link em 717/717).
// ⚠️ `filtrarpor=competencia` MISTURA meses (51 de julho + 336 de agosto no mesmo retorno) →
// a régua é o VENCIMENTO. Também é o que o morador quer dizer com "o boleto de julho".
// ---------------------------------------------------------------------------

// janelaDoMes: 'AAAA-MM' ou 'MM/AAAA' → { dtInicio, dtFim } em MM/DD/AAAA (formato da API).
// Entrada inválida devolve null DE PROPÓSITO: uma janela chutada consultaria o período errado e
// responderia "não há boleto nesse mês" para um mês que existe. PURA/testável.
export function janelaDoMes(mes) {
  if (typeof mes !== 'string') return null;
  const s = mes.trim();
  let ano, m;
  let g = s.match(/^(\d{4})-(\d{2})$/);
  if (g) { ano = +g[1]; m = +g[2]; }
  else {
    g = s.match(/^(\d{2})\/(\d{4})$/);
    if (!g) return null;
    m = +g[1]; ano = +g[2];
  }
  if (!(m >= 1 && m <= 12) || !(ano >= 2000 && ano <= 2100)) return null;
  const ultimo = new Date(Date.UTC(ano, m, 0)).getUTCDate(); // dia 0 do mês seguinte = último deste
  const mm = String(m).padStart(2, '0');
  return { dtInicio: `${mm}/01/${ano}`, dtFim: `${mm}/${String(ultimo).padStart(2, '0')}/${ano}` };
}

// classificarBoletoDoMes: PAGO × EM ABERTO × VENCIDO +30d. PURA/testável.
// 🔴 Boleto PAGO nunca sai com PIX — o morador pede o documento (sinistro, comprovante, imposto de
// renda) e receberia um código de pagamento, podendo pagar duas vezes. Sai só o link do documento.
// Vencido +30d também não sai por self-service: é dívida, vai à cobrança (guard que já existia).
// ⚠️ dt_vencimento_recb vem MM/DD/AAAA — o `new Date` do JS lê nesse formato; não "consertar" para DD/MM.
export function classificarBoletoDoMes(b, hoje = new Date()) {
  const pago = !!(b?.dt_liquidacao_recb || String(b?.fl_status_recb || '') === '3');
  const venc = b?.dt_vencimento_recb ? new Date(b.dt_vencimento_recb) : null;
  const diasVencido = venc && !isNaN(venc) ? Math.floor((hoje.getTime() - venc.getTime()) / 86400000) : 0;
  const base = {
    dias_vencido: diasVencido,
    dt_vencimento_recb: b?.dt_vencimento_recb || null,
    link_segundavia: b?.link_segundavia || null,
    vl_total_recb: b?.vl_total_recb ?? null,
    id_unidade_uni: b?.id_unidade_uni ?? null,
  };
  if (pago) {
    return { ...base, situacao: 'pago', liberado: true, dt_liquidacao_recb: b?.dt_liquidacao_recb || null };
  }
  if (diasVencido > 30) {
    return { ...base, situacao: 'vencido_30d', liberado: false };
  }
  return { ...base, situacao: 'em_aberto', liberado: true, st_pixqrcode_recb: b?.st_pixqrcode_recb || null };
}

// Texto do PIX ausente. Exportado para o teste conferir o texto REAL (uma cópia no teste passaria
// mesmo com o código dizendo outra coisa). NÃO pode sugerir falha temporária — ver get_boleto_2via.
export const NOTA_PIX_INDISPONIVEL =
  'Este boleto não tem PIX copia e cola (o condomínio emite o boleto por outro banco). '
  + 'O pagamento é pelo link ou pelo código de barras do PDF.';

// calcularOutrasCobrancas: quantas cobranças em aberto existem ALÉM da que estamos entregando.
// PURA/testável (test_boleto_outras_cobrancas.mjs).
// `qtd` vem de get_inadimplencia (qtd_cobrancas_em_aberto = cobranças VENCIDAS em aberto).
// Se o boleto entregue já está vencido, ele próprio conta nesse total → desconta 1.
// Se ainda está A VENCER, ele não entra na inadimplência → o total todo é "além deste".
export function calcularOutrasCobrancas(qtd, diasVencido) {
  const n = Number(qtd) || 0;
  if (n <= 0) return 0;
  return Number(diasVencido) > 0 ? Math.max(0, n - 1) : n;
}

// get_boleto_2via: cobranca/index?status=pendentes&UNIDADES[0]=<id>  → PIX copia-e-cola + link.
// ATENÇÃO: idUnidade é ignorado; o filtro é UNIDADES[0]=. Conferir id_unidade_uni no retorno (LGPD).
// `_semInadimplencia`: pula o cruzamento com a inadimplência (usado pelo get_boleto_pdf_url, que só
// precisa da URL — evita repetir a chamada quando a Ana pede boleto + PDF no mesmo turno).
export async function get_boleto_2via({ id_condominio, id_unidade, mes, _semInadimplencia } = {}) {
  if (!id_condominio || !id_unidade) return { erro: 'faltam id_condominio e id_unidade' };
  // Garantidora 'total': a NCS não gera boleto pelo Superlógica → direcionar à garantidora (nem consulta o sistema).
  const gar = await garantidoraDe(id_condominio);
  if (gar && gar.tipo === 'total') {
    return { liberado: false, motivo: 'garantidora', garantidora: gar.garantidora, ...(gar.nota_extra ? { nota_extra: gar.nota_extra } : {}) };
  }
  // Pediu um MÊS específico → consulta própria: a chamada padrão (sem data) só enxerga o mês corrente.
  if (mes) return await _boletoDoMes({ id_condominio, id_unidade, mes });
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
  const r = {
    liberado: true, dias_vencido: diasVencido,
    id_unidade_uni: b.id_unidade_uni,
    st_pixqrcode_recb: b.st_pixqrcode_recb || null,
    link_segundavia: b.link_segundavia || null,
    vl_total_recb: b.vl_total_recb,
    dt_vencimento_recb: b.dt_vencimento_recb,
  };
  // PIX ausente NÃO é falha nossa nem coisa passageira: quando o boleto do condomínio é emitido por
  // OUTRO banco (o Parque Atlanta usa SICOOB — confirmado pelo Fernando 27/07), o Superlógica não
  // devolve o copia-e-cola e nunca vai devolver. Medido: 0 de 174 boletos do Atlanta têm PIX, contra
  // 100% no Lume/Vancouver. A Ana vinha dizendo "no momento não consegui obter o PIX", que sugere
  // erro temporário e faz o morador tentar de novo à toa. Texto neutro e verdadeiro nos dois casos.
  if (!r.st_pixqrcode_recb) {
    r.pix_disponivel = false;
    r.nota_pix = NOTA_PIX_INDISPONIVEL;
  }
  // 🔴 A régua de ~30d NÃO enxerga o que venceu antes — medido 27/07: nem com `status=todos` o
  // `cobranca/index` passa de ~21 dias de atraso (Atlanta/Allure/ABV/Lume). Quem tinha dívida antiga
  // recebia só o boleto novo e ia embora achando que era tudo: a Ana disse "2 cobranças" e a cobrança
  // via 3 (conv 219), e a Naiara achou boleto de 63 dias (conv 186) — onde o Fernando pediu, por
  // escrito, "colocar para verificar que tem boletos mais antigos em aberto".
  // Cruzamos com a inadimplência COMPLETA e avisamos; nunca cravamos valor (juros são da cobrança).
  if (!_semInadimplencia) {
    try {
      const inad = await get_inadimplencia({ id_condominio, id_unidade });
      if (inad && inad.status === 'inadimplente') {
        const outras = calcularOutrasCobrancas(inad.qtd_cobrancas_em_aberto, diasVencido);
        if (outras > 0) {
          r.outras_cobrancas_em_aberto = outras;
          r.aviso_morador =
            `Atenção: além deste boleto, constam ${outras} cobrança(s) em aberto nesta unidade. ` +
            'Posso pedir à equipe de cobrança a relação completa e atualizada.';
        }
        if (inad.no_juridico) r.no_juridico = true; // roteamento interno; nunca dito ao morador
      }
    } catch { /* inadimplência indisponível → entrega o boleto sem o aviso, nunca bloqueia */ }
  }
  return r;
}

// _boletoDoMes: busca o boleto de um mês específico (rota do "quero o de julho").
// Guards preservados: jurídico continua fora do self-service (pagar avulso não quita processo) e
// o anti-troca por id_unidade_uni vale igual — o `UNIDADES[0]` filtra, mas o `idUnidade` a API
// IGNORA em silêncio, então conferir o id de volta é obrigatório (risco de entregar boleto alheio).
async function _boletoDoMes({ id_condominio, id_unidade, mes }) {
  const jan = janelaDoMes(mes);
  if (!jan) return { liberado: false, motivo: 'mes_invalido', mes_recebido: String(mes ?? '') };
  const [jur, data] = await Promise.all([
    _unidadeNoJuridico({ id_condominio, id_unidade }),
    slGet('cobranca/index', {
      idCondominio: id_condominio, status: 'todos', filtrarpor: 'vencimento',
      dtInicio: jan.dtInicio, dtFim: jan.dtFim, 'UNIDADES[0]': id_unidade,
    }),
  ]);
  if (jur.no_juridico) return { liberado: false, motivo: 'unidade_no_juridico', qtd_processos: jur.qtd_processos };
  const itens = (Array.isArray(data) ? data : []).filter((b) => String(b.id_unidade_uni) === String(id_unidade));
  if (!itens.length) return { liberado: false, motivo: 'sem_boleto_no_mes', mes };
  const ord = itens.sort((a, z) => new Date(a.dt_vencimento_recb) - new Date(z.dt_vencimento_recb));
  const r = { ...classificarBoletoDoMes(ord[0], new Date()), mes };
  if (ord.length > 1) r.qtd_no_mes = ord.length; // condomínio com taxa + extra no mesmo mês
  if (r.situacao === 'em_aberto' && !r.st_pixqrcode_recb) {
    r.pix_disponivel = false;
    r.nota_pix = NOTA_PIX_INDISPONIVEL;
  }
  return r;
}

// get_boleto_pdf_url: deriva a URL do PDF da 2ª via (link_segundavia com FaturaHtml→FaturaPdf — validado em
// .tmp/test_link_pdf.js: FaturaPdf entrega application/pdf real ~360KB, URL pública; render=pdf NÃO funciona).
// Reusa get_boleto_2via → mesma seleção do boleto + guards (garantidora 'total', vencido +30 dias). NÃO baixa nem
// envia: só devolve a URL + dados (o download/envio fica no octadesk.mjs). Anti-troca já garantido pelo get_boleto_2via.
export async function get_boleto_pdf_url({ id_condominio, id_unidade, mes } = {}) {
  // `_semInadimplencia`: aqui só interessa a URL do PDF. O aviso de débito antigo já veio no
  // get_boleto_2via do mesmo turno — repetir a consulta seria uma chamada à toa por atendimento.
  // `mes` PRECISA ser repassado: sem isso a Ana diria "segue o de julho" e anexaria o do mês
  // corrente — o anexo errado com a legenda certa é pior que não entregar.
  const b = await get_boleto_2via({ id_condominio, id_unidade, mes, _semInadimplencia: true });
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

// resumirCobrancasEmAberto: transforma o `recebimento[]` do inadimplencia/index na relação que a
// pessoa pediu ("quais meses eu devo?"). PURA/testável. Antes a Ana só sabia a QUANTIDADE.
// 🔴 `total_original` é a soma dos valores ORIGINAIS — sem juros, multa e honorários, que variam por
// condomínio e quem calcula é a cobrança. Nunca existe `total_a_pagar` aqui: um número apresentado
// como "é isso que você deve" sairia MENOR que o real e a pessoa pagaria achando que quitou.
// ⚠️ dt_vencimento_recb vem MM/DD/AAAA; a saída vai DD/MM/AAAA (o que o morador lê).
const MAX_COBRANCAS_LISTADAS = 12;
export function resumirCobrancasEmAberto(recebimentos, hoje = new Date()) {
  const arr = Array.isArray(recebimentos) ? recebimentos : [];
  const itens = arr.map((b) => {
    const d = b?.dt_vencimento_recb ? new Date(b.dt_vencimento_recb) : null;
    const valido = d && !isNaN(d);
    const n = Number(String(b?.vl_total_recb ?? '').replace(',', '.'));
    return {
      vencimento: valido ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : null,
      _ord: valido ? d.getTime() : Infinity,
      dias_vencido: valido ? Math.floor((hoje.getTime() - d.getTime()) / 86400000) : null,
      valor: Number.isFinite(n) && String(b?.vl_total_recb ?? '').trim() !== '' ? n : null,
      descricao: b?.st_label_recb || null,
      em_acordo: !!(b?.id_acordo_recb && String(b.id_acordo_recb).trim()),
      no_juridico: !!(b?.id_processo_proc && String(b.id_processo_proc).trim()),
    };
  }).sort((a, z) => a._ord - z._ord);
  const total_original = itens.reduce((s, i) => s + (i.valor || 0), 0);
  const listadas = itens.slice(0, MAX_COBRANCAS_LISTADAS).map(({ _ord, ...r }) => r);
  return {
    qtd: itens.length,
    cobrancas: listadas,
    ...(itens.length > MAX_COBRANCAS_LISTADAS ? { truncado: true } : {}),
    total_original: Math.round(total_original * 100) / 100,
    tem_juridico: itens.some((i) => i.no_juridico),
    nota_valor:
      'Estes são os valores originais de cada cobrança. Não incluem juros, multa e honorários, '
      + 'que são calculados pela equipe de cobrança na data do pagamento.',
  };
}

// get_inadimplencia: situação COMPLETA de débitos da unidade — usa `inadimplencia/index` (enxerga boletos ANTIGOS,
// em cobrança e jurídico), NÃO só os recentes do `cobranca/index?status=pendentes` (esse era o PONTO CEGO que fazia a
// Ana afirmar "só deve esse boleto" para quem devia dezenas de milhares). ⚠️ idUnidade é ignorado → filtro = UNIDADES[0]=.
// Validado 21/06: ABV (191) tem 74 inadimplentes / R$457k; campos por unidade = qtd_cobrancas_em_aberto + total_original.
// Retorna { status: 'inadimplente' (+qtd_cobrancas_em_aberto, +no_juridico/qtd_processos) | 'sem_debito_vencido' | 'gerido_por_garantidora' | 'indisponivel' }.
// no_juridico:true = a unidade tem processo judicial aberto (a 2ª via self-service fica bloqueada → cobrança).
export async function get_inadimplencia({ id_condominio, id_unidade, detalhar } = {}) {
  const gar = await garantidoraDe(id_condominio);
  if (gar && gar.tipo === 'total') {
    return { status: 'gerido_por_garantidora', garantidora: gar.garantidora, ...(gar.nota_extra ? { nota_extra: gar.nota_extra } : {}) };
  }
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
    // `detalhar`: 2ª chamada SEM apenasResumoInad, que traz `recebimento[]` itemizado (quais meses).
    // Só quando pedido — é uma chamada a mais e o caso comum ("estou devendo?") não precisa dela.
    // Fail-open: se a consulta do detalhe falhar, o resumo sai igual — nunca derruba a resposta.
    // 🔴 Unidade em PROCESSO JUDICIAL não recebe a relação: os valores em disputa não são os do ERP,
    // e a regra da casa já tira o jurídico do self-service (mesma razão que bloqueia a 2ª via).
    // Vale para a lista; o `no_juridico` continua indo ao roteamento interno como sempre.
    if (detalhar && !r.no_juridico) {
      try {
        const det = await slGet('inadimplencia/index', { idCondominio: id_condominio, 'UNIDADES[0]': id_unidade });
        const linhasDet = Array.isArray(det) ? det : (det ? [det] : []);
        // Anti-troca no ITEM: o `idUnidade` a API ignora e o topo da resposta nem sempre traz a unidade,
        // então conferimos o id_unidade_uni de cada recebimento — nunca listar dívida de outro morador.
        const recs = linhasDet
          .flatMap((l) => (Array.isArray(l?.recebimento) ? l.recebimento : []))
          .filter((b) => String(b?.id_unidade_uni) === String(id_unidade));
        if (recs.length) r.detalhe = resumirCobrancasEmAberto(recs);
      } catch { /* detalhe indisponível → segue com o resumo */ }
    }
    return r;
  }
  return { status: 'sem_debito_vencido' }; // não consta na inadimplência (pode ter boleto A VENCER → get_boleto_2via)
}
