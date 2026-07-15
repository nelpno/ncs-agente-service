// valor_taxa.mjs — VALOR da taxa condominial de UMA unidade, decomposto em rubricas
// (Taxa Condomínio / Taxa Extra / Fundo de Reserva / ...). Pedido do Fernando 15/07/2026:
// a Jussara perguntou "qual a taxa do Lume?" e o robô não sabia consultar.
//
// ⚠️ NÃO confundir com src/taxa.mjs (consultar_taxa_condominial), que diz o que está INCLUSO
// na taxa (gás/água/internet). Aqui é o VALOR em R$.
//
// FONTE (mapeada ao vivo em 15/07): a API NÃO expõe a composição do boleto por endpoint —
// `cobranca/composicao` responde 500 (sem acesso), `cotas|lancamentos|rateios` 404/vazio e
// `receitas/index` estoura a memória do servidor. Ela só existe na 2ª via (`link_segundavia`),
// e o Superlógica serve a 2ª via em DOIS formatos, conforme o estado do boleto:
//   • EM ABERTO → HTML (latin-1), tabela "O que estou pagando?";
//   • PAGO      → PDF, bloco "Composição da cobrança".
// Suportar só HTML deixaria a tool inútil: no Lume 51 dos 60 boletos estão pagos, então ela
// só responderia sobre inadimplentes — e a cobertura mudaria conforme o dia do mês. Por isso
// os dois parsers. (Não há como forçar HTML no boleto pago: testado no endpoint dedicado
// `gerarlinksegundavia` e em 4 variações de sufixo — todos devolvem application/pdf.)
//
// ANTI-ALUCINAÇÃO (o motivo de isto não ser um scraper ingênuo): a soma das rubricas TEM que
// bater com `vl_total_recb`, que vem da API. Se não bater, a tool devolve erro em vez de um
// valor — falha fechada, nunca chuta. Isso também protege o parser do PDF, que convive com o
// balancete do condomínio no mesmo arquivo ("TAXA CONDOMÍNIO 87,86% 101.071,41" é ruído, não
// rubrica). Encargos (juros/multa/acréscimos) ficam fora da soma: `vl_total_recb` não os inclui.
//
// Por que a unidade é obrigatória: frações ideais fazem 2 apartamentos do MESMO condomínio
// pagarem valores diferentes (Lume: 861,24 x 1.008,69). Sem unidade não há resposta correta.
import { extractText, getDocumentProxy } from 'unpdf';
import { config } from '../../src/config.mjs';
import { resolver_condominio, resolver_morador } from './superlogica.mjs';
import { carregarCondominio } from '../../gerador/src/gerar-lib.mjs';

const TIMEOUT = Number(process.env.SL_TIMEOUT_MS || 45000);

async function slGet(controllerAction, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${config.slBase}/${controllerAction}${qs ? '?' + qs : ''}`, {
    headers: { app_token: config.slApp, access_token: config.slAccess, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`Superlógica ${controllerAction} ${r.status}`);
  return r.json();
}

// Encargo = o que a fatura soma por ATRASO (não faz parte da composição da taxa).
// `vl_total_recb` (API) não inclui esses valores — por isso eles saem da soma do guard.
const ENCARGO_RE = /(acr[eé]scimo|juros|multa|corre[cç][aã]o|honor[aá]rio|atualiza[cç][aã]o)/i;

const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** "R$734,61" -> 734.61 | "R$-4,68" -> -4.68 | lixo -> null. Puro. */
export function _parseValorBR(s) {
  const t = String(s ?? '').replace(/<[^>]+>/g, '').replace(/\s|&nbsp;/g, '').replace(/R\$/i, '');
  if (!/^-?\d{1,3}(\.\d{3})*(,\d{2})?$|^-?\d+(,\d{2})?$/.test(t)) return null;
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * _parseComposicao(html) → [{ descricao, valor, encargo }]
 * Lê a tabela "O que estou pagando?" da 2ª via: <td class='item'>DESC</td><td class='valor'>R$X</td>.
 * Puro (testável sem rede) — ver test/test_valor_taxa.mjs.
 */
export function _parseComposicao(html) {
  const h = String(html || '');
  const ini = h.indexOf('corpoComposicao');
  if (ini < 0) return [];
  const fim = h.indexOf('</table>', ini);
  const bloco = h.slice(ini, fim < 0 ? undefined : fim);
  const re = /<td[^>]*class=['"]item['"][^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class=['"]valor['"][^>]*>([\s\S]*?)<\/td>/gi;
  const out = [];
  for (const m of bloco.matchAll(re)) {
    const descricao = m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const valor = _parseValorBR(m[2]);
    if (!descricao || valor === null) continue;
    out.push({ descricao, valor, encargo: ENCARGO_RE.test(descricao) });
  }
  return out;
}

/**
 * _parseComposicaoPdf(texto) → [{ descricao, valor, encargo }]
 * A 2ª via do boleto PAGO vem em PDF. O texto extraído é CORRIDO (sem quebras de linha), então
 * o bloco é delimitado por "Composição da cobrança" … régua de underscores — o que também
 * descarta o balancete do condomínio que vem logo depois no mesmo PDF. Puro (testável sem rede).
 */
export function _parseComposicaoPdf(texto) {
  const t = String(texto || '');
  const MARCA = 'Composição da cobrança';
  const ini = t.indexOf(MARCA);
  if (ini < 0) return [];
  const resto = t.slice(ini + MARCA.length);
  const fim = resto.search(/_{6,}/);
  const bloco = fim < 0 ? resto : resto.slice(0, fim);
  const out = [];
  // "<descrição> <valor>" repetido; valor = 1.234,56 / 56,67 / -4,68 (datas como 22.06.26 não casam: sem vírgula)
  for (const m of bloco.matchAll(/(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})(?=\s|$)/g)) {
    const descricao = m[1].trim().replace(/\s+/g, ' ');
    const valor = Number(m[2].replace(/\./g, '').replace(',', '.'));
    if (!descricao || !Number.isFinite(valor)) continue;
    out.push({ descricao, valor, encargo: ENCARGO_RE.test(descricao) });
  }
  return out;
}

/**
 * Baixa a 2ª via e devolve as rubricas, seja ela HTML (boleto em aberto) ou PDF (boleto pago).
 * O formato é detectado pelos magic bytes, não pelo content-type nem pelo sufixo da URL —
 * a URL diz "FaturaHtml" mesmo quando o servidor devolve PDF.
 */
async function baixarComposicao(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`2ª via HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return _parseComposicaoPdf(text);
  }
  // HTML: o Superlógica serve latin-1 → decodifica explícito (senão os acentos viram lixo).
  return _parseComposicao(buf.toString('latin1'));
}

/**
 * _conferir(itens, boleto) → { ok, total, detalhe? }
 * O guard. A leitura só é aceita se alguma soma consistente das rubricas explicar algum total
 * que veio da API. São 4 combinações porque o Superlógica não é uniforme (medido em 36 boletos):
 *  • o normal é a soma SEM encargos == vl_total_recb (21/26);
 *  • boleto pago em atraso traz "Multa"/"Juros" DENTRO da composição e do vl_total_recb (3/26);
 *  • boleto de acordo bate com vl_emitido_recb, e o vl_total_recb já vem com a multa (2/26).
 * Aceitar as 4 leva a cobertura de 58% para 72% sem nenhum falso positivo (0/36 reportado errado).
 * Coincidência entre valores em centavos é desprezível — e o preço de errar aqui seria dizer um
 * valor errado de taxa para um morador, que é justamente o que não pode acontecer.
 */
export function _conferir(itens, boleto = {}) {
  const sem = Number(itens.filter((i) => !i.encargo).reduce((s, i) => s + i.valor, 0).toFixed(2));
  const com = Number(itens.reduce((s, i) => s + i.valor, 0).toFixed(2));
  const vlTotal = Number(boleto.vl_total_recb);
  const vlEmitido = Number(boleto.vl_emitido_recb);
  const bate = (a, b) => Number.isFinite(b) && Math.abs(a - b) <= 0.02;
  for (const alvo of [vlTotal, vlEmitido]) {
    if (bate(sem, alvo) || bate(com, alvo)) return { ok: true, total: alvo };
  }
  return {
    ok: false,
    detalhe: `a composição lida (${sem.toFixed(2)}${com !== sem ? ` ou ${com.toFixed(2)} com encargos` : ''}) não fecha com o valor do sistema `
      + `(${Number.isFinite(vlTotal) ? vlTotal.toFixed(2) : '?'})`,
  };
}

/** Escolhe o boleto que representa "a taxa": o de vencimento mais recente. */
function escolherBoleto(arr) {
  const dt = (s) => { const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? new Date(`${m[3]}-${m[1]}-${m[2]}`).getTime() : 0; };
  return [...arr].sort((a, b) => dt(b.dt_vencimento_recb) - dt(a.dt_vencimento_recb))[0] || null;
}

/**
 * Nome do condomínio → id do Superlógica. Usa o `superlogica_nome` CURADO do catálogo quando o
 * condomínio tem um (é o nome que existe no ERP; "Residencial Park" → "PARQUE ..."), e cai pro
 * nome cru quando não tem — assim a consulta de valor cobre os 54 condomínios do token, não só
 * os 51 que têm catálogo de multa.
 */
async function resolverCondoId(condominio) {
  let nome = condominio;
  try {
    const d = carregarCondominio(condominio);
    nome = d.superlogica_nome || d.condominio?.nome || condominio;
  } catch { /* sem catálogo: segue com o nome cru */ }
  return resolver_condominio({ nome });
}

/**
 * consultar_valor_taxa({ condominio, unidade, bloco? })
 *  → { ok:true, condominio, unidade, vencimento, total, total_formatado, rubricas:[{descricao,valor,valor_formatado}], encargos:[...] }
 *  → { ok:false, motivo } — motivos: informe_condominio | informe_unidade | condominio_nao_encontrado |
 *    unidade_nao_encontrada | ambiguo | sem_boleto | composicao_indisponivel | composicao_nao_confere
 */
export async function consultar_valor_taxa({ condominio, unidade, bloco } = {}) {
  if (!condominio) return { ok: false, motivo: 'informe_condominio' };
  // Sem unidade não existe resposta certa: frações ideais fazem 2 aptos do mesmo prédio pagarem
  // valores diferentes. O prompt manda PERGUNTAR a unidade — nunca responder "a taxa do X é Y".
  if (!unidade) return { ok: false, motivo: 'informe_unidade' };

  const cond = await resolverCondoId(condominio);
  if (!cond.encontrado) {
    return { ok: false, motivo: 'condominio_nao_encontrado', detalhe: cond.motivo, opcoes: cond.opcoes };
  }
  const id_condominio = cond.id;

  // Reusa o resolvedor de unidade do Estagiário: já trata rótulo/zero à esquerda e tem o
  // guard de ambiguidade (Tivoli "10 G" ≠ "010 G", donos diferentes).
  const m = await resolver_morador({ id_condominio, unidade, bloco });
  if (!m.encontrado) {
    if (m.motivo === 'ambiguo') return { ok: false, motivo: 'ambiguo', opcoes: m.opcoes, detalhe: m.detalhe };
    return { ok: false, motivo: 'unidade_nao_encontrada', detalhe: m.motivo };
  }
  const id_unidade = m.moradores[0].id_unidade;
  const apartamento = m.moradores[0].apartamento;

  // ⚠️ o filtro de unidade é UNIDADES[0]= — `idUnidade` é IGNORADO em silêncio (risco de pegar
  // boleto de OUTRO condômino). Por isso o resultado é conferido item a item logo abaixo.
  let arr = await slGet('cobranca/index', { idCondominio: id_condominio, 'UNIDADES[0]': id_unidade, status: 'pendentes' });
  if (!Array.isArray(arr) || !arr.length) {
    arr = await slGet('cobranca/index', { idCondominio: id_condominio, 'UNIDADES[0]': id_unidade, status: 'todos' });
  }
  const daUnidade = (Array.isArray(arr) ? arr : []).filter((b) => String(b.id_unidade_uni) === String(id_unidade));
  if (!daUnidade.length) return { ok: false, motivo: 'sem_boleto', unidade: apartamento };

  const bol = escolherBoleto(daUnidade);
  if (!bol?.link_segundavia) return { ok: false, motivo: 'composicao_indisponivel', unidade: apartamento };

  let itens;
  try { itens = await baixarComposicao(bol.link_segundavia); }
  catch (e) { return { ok: false, motivo: 'composicao_indisponivel', detalhe: e.message, unidade: apartamento }; }
  if (!itens.length) return { ok: false, motivo: 'composicao_indisponivel', unidade: apartamento };

  const rubricas = itens.filter((i) => !i.encargo);
  const encargos = itens.filter((i) => i.encargo);
  const conferencia = _conferir(itens, bol);

  // GUARD: a composição só é reportada se ela EXPLICA um total que veio da API.
  if (!conferencia.ok) {
    return { ok: false, motivo: 'composicao_nao_confere', unidade: apartamento, detalhe: conferencia.detalhe };
  }
  const total = conferencia.total;

  return {
    ok: true,
    condominio: cond.nome,
    unidade: apartamento,
    vencimento: String(bol.dt_vencimento_recb || '').slice(0, 10),
    total,
    total_formatado: brl(total),
    rubricas: rubricas.map((r) => ({ descricao: r.descricao, valor: r.valor, valor_formatado: brl(r.valor) })),
    encargos: encargos.map((r) => ({ descricao: r.descricao, valor: r.valor, valor_formatado: brl(r.valor) })),
  };
}
