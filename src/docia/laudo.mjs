// laudo.mjs — o verificador de evidências e a persistência do laudo.
//
// A REGRA da casa (a mesma do extrair-catalogo.mjs dos regimentos): o LLM dá a ÂNCORA, o CÓDIGO confere
// contra a fonte. Campo cuja âncora não existe literalmente na transcrição NÃO EXISTE — é derrubado antes
// de virar tick na tela. Um tick sem evidência verificável seria pior que tick nenhum: o aprovador confia
// nele e assina.
//
// Diferença honesta em relação aos regimentos: lá a fonte é o .md original (verdade externa ao LLM);
// aqui o contrato é escaneado e a fonte é a transcrição do passo 1 — produzida por LLM. O check é mais
// fraco que fatiar de um texto digital, e é justo dizer isso. O que ele garante de verdade: o passo 2
// (que NÃO vê o papel) não consegue inventar um campo e confirmar a si mesmo. Alucinação teria que
// acontecer igual nos dois passos, em modos diferentes (percepção × estruturação), para passar.

import { sbEnabled, sbInsert } from '../db_ncs.mjs';
import { norm } from './conferir.mjs';

// Duas perguntas, e as duas medidas contra o documento real do cliente:
//   1. ancorada()  — a âncora foi COPIADA da transcrição, ou o modelo escreveu uma frase que não existe?
//   2. provaValor() — a âncora prova o VALOR que ela diz sustentar?
//
// A regra ingênua "âncora tem que ter ≥ N caracteres" foi medida e REPROVADA no contrato real: derrubou
// `bloco: "11"` com a âncora "bloco 11" (8 chars) — citação literal, verdadeira, achada na fonte.
// Comprimento não prova nada; o que prova é a âncora conter o valor. O piso curto abaixo só evita âncora
// degenerada ("SP") casando por acaso.
const MIN_ANCORA = 6;

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Normalização de comparação: caixa/acento/espaço + PONTUAÇÃO.
 *  Por que ignorar pontuação: medido no contrato real — o original traz "CPF nº 414.990.298/45" (barra
 *  no lugar do hífen) e o passo 2 "conserta" para "-" ao citar. Exigir a pontuação torta derrubaria
 *  citação verdadeira em massa. Palavra continua tendo que existir: frase inventada não passa.
 *
 *  ⚠️ Só [a-z0-9 ], e NÃO \p{L}\p{N} — a diferença custou 2 análises em cada 5. "º" (U+00BA, indicador
 *  ordinal) é classificado como LETRA no Unicode e sobrevivia ao \p{L}; "°" (U+00B0, grau) é SÍMBOLO e
 *  era removido. Como o passo 1 transcreve "nº" e o passo 2 às vezes cita "n°", a âncora do locatário
 *  ("CPF nº ...") não casava e a PARTE INTEIRA do contrato caía — calada, como pendência de CPF.
 *  O norm() já reduz acento a ASCII (ç→c), então [a-z0-9 ] não perde letra de português. */
export const normAncora = (s) => norm(s).replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

const soDig = (s) => String(s ?? '').replace(/\D/g, '');

/** A âncora existe LITERALMENTE na fonte? Pega a fabricação plausível — inclusive a costura de dois
 *  trechos distantes numa frase que nunca existiu (medido: o modelo faz isso mesmo proibido no prompt).
 *  Usado como prova para os campos DERIVADOS (onde o valor é leitura do modelo, não cópia do papel). */
export function ancorada(evidencia, fonteNormAncora) {
  const e = normAncora(evidencia);
  if (e.length < MIN_ANCORA) return false;
  return String(fonteNormAncora || '').includes(e);
}

/** Onde este valor aparece no texto normalizado? → [ini,fim] ou null. Entende data por extenso e
 *  pontuação de CPF (os dois lados passam pelo mesmo normalizador, então dígito casa com dígito). */
function acharValor(valor, alvoNorm) {
  const v = String(valor ?? '').trim();
  if (!v || !alvoNorm) return null;
  const candidatos = /^\d{4}-\d{2}-\d{2}$/.test(v) ? variantesData(v) : [normAncora(v)].filter(Boolean);
  for (const c of candidatos) {
    const i = alvoNorm.indexOf(c);
    if (i >= 0) return [i, i + c.length];
  }
  return null;
}

/** Formas usuais de uma data no papel (DD/MM/AAAA, "19 de maio de 2027", ISO, DD/MM/AA). */
function variantesData(iso) {
  const [y, m, d] = iso.split('-');
  const mes = MESES[Number(m) - 1] ? normAncora(MESES[Number(m) - 1]) : null;
  return [
    `${d}${m}${y}`, `${y}${m}${d}`, `${d}${m}${y.slice(2)}`,
    ...(mes ? [`${Number(d)} de ${mes} de ${y}`, `${d} de ${mes} de ${y}`] : []),
  ];
}

/** A âncora sustenta ESTE valor? (valor nulo não precisa de prova) */
export function provaValor(valor, ancora) {
  if (!String(valor ?? '').trim()) return true;
  return !!acharValor(valor, normAncora(ancora));
}

// Janela (em caracteres) de contexto ao redor do valor que precisa existir na fonte.
// Grande demais → volta a ser refém da prosa (o bug do "portadora"); pequena demais → "11" casa
// com qualquer coisa e a prova não prova nada. 12 cobre "bloco ", "cpf n ", "apartamento ".
const JANELA = 12;

/**
 * O valor está na fonte NO MESMO CONTEXTO LOCAL em que o modelo o citou?
 *
 * Esta é a regra que substituiu "a âncora inteira tem que existir na fonte" — que era correta em
 * princípio e ruim na prática: MEDIDO, 2 em 5 análises do contrato real perdiam o locatário inteiro
 * (nome E CPF) porque o passo 2 escreveu "portadora" onde o papel diz "portador" — 1 caractere, a 60
 * do CPF, contaminado pela linha do locador logo acima. Exigir a prosa inteira é refém do modelo;
 * a janela local exige o que de fato prova o campo: este valor, naquele contexto, existe no papel.
 * Continua pegando invenção ("bloco 12" com âncora "bloco 12" não acha "bloco 12" na fonte).
 */
export function valorCorroborado(valor, ancora, fonteNorm) {
  if (!String(valor ?? '').trim()) return true;
  const aNorm = normAncora(ancora);
  const pos = acharValor(valor, aNorm);
  if (!pos) return false; // a âncora nem contém o valor que ela diz sustentar
  const janela = aNorm.slice(Math.max(0, pos[0] - JANELA), Math.min(aNorm.length, pos[1] + JANELA));
  return String(fonteNorm || '').includes(janela);
}

const CHAVES_META = ['evidencia', 'pagina'];
const valores = (o) => Object.entries(o || {}).filter(([k, v]) => !CHAVES_META.includes(k) && v != null && String(v).trim() !== '');

// Campos DERIVADOS: o valor é LEITURA do modelo, não cópia do papel — "proprietario" não aparece na
// cláusula, é a conclusão dela. Para estes a prova é a CLÁUSULA existir literalmente na fonte
// (pega a costura de trechos distantes, que é justamente como o modelo erra aqui). O valor segue como
// SUGESTÃO: quem decide é o morador confirmando para a Ana (§4d) — a IA não escolhe quem recebe boleto.
const DERIVADOS = new Set(['responsavel_taxa']);

/**
 * Derruba tudo que o passo 2 não conseguiu provar contra a transcrição.
 * Puro e testável sem rede — é o guard mais importante do módulo.
 *
 * Granularidade: por SUB-VALOR, não por campo inteiro. Se a âncora prova o nome mas não o CPF que o
 * modelo alegou junto, o nome fica e o CPF cai. Derrubar o campo todo perderia dado verdadeiro; manter
 * o CPF não-provado seria pôr no laudo um número que ninguém conferiu.
 * @returns {{extracao:object, descartados:Array<{onde:string,motivo:string,evidencia:string}>}}
 */
export function verificarEvidencias(extracao, fonte) {
  const fonteNorm = normAncora(fonte);
  const out = JSON.parse(JSON.stringify(extracao || {}));
  const descartados = [];
  const zerar = (campo) => { for (const [k] of valores(campo)) campo[k] = null; campo.evidencia = ''; };

  for (const [nome, campo] of Object.entries(out.campos || {})) {
    if (!valores(campo).length) continue; // sem valor não há o que provar

    // Piso: âncora ausente ou degenerada ("11") não corrobora nada — derruba o campo.
    // Zera os valores e preserva a chave: conferir.mjs trata ausência como pendente/nao_verificavel,
    // NUNCA como ok. Derrubar um campo verdadeiro custa um falso-PENDENTE (barato, e é o lado certo).
    if (normAncora(campo.evidencia).length < MIN_ANCORA) {
      descartados.push({ onde: `campos.${nome}`, motivo: 'evidencia_curta', evidencia: String(campo.evidencia || '').slice(0, 120) });
      zerar(campo);
      continue;
    }

    if (DERIVADOS.has(nome)) {
      if (!ancorada(campo.evidencia, fonteNorm)) {
        descartados.push({ onde: `campos.${nome}`, motivo: 'clausula_nao_encontrada', evidencia: String(campo.evidencia || '').slice(0, 120) });
        zerar(campo);
      }
      continue;
    }

    for (const [k, v] of valores(campo)) {
      if (!valorCorroborado(v, campo.evidencia, fonteNorm)) {
        descartados.push({ onde: `campos.${nome}.${k}`, motivo: 'valor_nao_corroborado', evidencia: String(v).slice(0, 60) });
        campo[k] = null;
      }
    }
    // Caiu tudo → a evidência não sustenta mais nada: some. Tick com evidência e sem valor confunde
    // quem está aprovando, que é exatamente quem não pode ficar confuso.
    if (!valores(campo).length) campo.evidencia = '';
  }

  out.assinaturas = (out.assinaturas || []).filter((a) => {
    if (a?.presente === false) return true; // "campo vazio" é observação, não alegação de fato
    // O nome sob a assinatura é o que pega "assinou no campo trocado" — não pode ser palpite do modelo.
    // Quando ele existe, é ele que corrobora a assinatura (mesma janela local dos demais campos).
    if (a?.nome_sob_assinatura) {
      if (valorCorroborado(a.nome_sob_assinatura, a.evidencia, fonteNorm)) return true;
      descartados.push({ onde: `assinaturas.${a.rotulo || '?'}`, motivo: 'evidencia_nao_corroborada', evidencia: String(a.evidencia || '').slice(0, 120) });
      return false; // assinatura alegada que a transcrição não mostra = assinatura que não existe
    }
    if (ancorada(a?.evidencia, fonteNorm)) return true;
    descartados.push({ onde: `assinaturas.${a?.rotulo || '?'}`, motivo: 'evidencia_nao_encontrada', evidencia: String(a?.evidencia || '').slice(0, 120) });
    return false;
  });

  out.testemunhas = (out.testemunhas || []).filter((t) => t?.presente === false || ancorada(t?.evidencia, fonteNorm));
  return { extracao: out, descartados };
}

/** Só o que a Ana precisa ver. O texto do contrato NUNCA sai daqui para o contexto do agente (§6.4). */
export function resumirParaAgente(laudo) {
  return {
    laudo_id: laudo.id,
    parecer: laudo.parecer,
    tipo_documento: laudo.tipo_documento,
    pendencias: laudo.pendencias,
    divergencias: laudo.divergencias,
    unidade: laudo.campos_extraidos?.unidade?.valor || null,
    bloco: laudo.campos_extraidos?.bloco?.valor || null,
    condominio: laudo.campos_extraidos?.condominio?.valor || null,
    locatario_nome: laudo.campos_extraidos?.locatario?.nome || null,
    locatario_cpf: laudo.campos_extraidos?.locatario?.cpf || null,
    vigencia_fim: laudo.campos_extraidos?.vigencia?.fim || null,
    // Sugestão, não decisão: a Ana CONFIRMA com o morador (null = pergunta do zero, como hoje).
    responsavel_taxa_sugerido: laudo.campos_extraidos?.responsavel_taxa?.valor || null,
    confianca: laudo.confianca,
  };
}

/** Monta o laudo canônico (shape §3.1 da arquitetura). Puro. */
export function montarLaudo({ id, extracao, veredito, paginas, arquivos, origem, descartados, modelo, uso }) {
  return {
    id,
    versao_motor: 'docia-1',
    modelo: modelo || null,
    criado_em: new Date().toISOString(),
    origem: origem || {},
    tipo_documento: extracao?.tipo_documento || null,
    arquivos: arquivos || [],
    paginas: (paginas || []).map((p) => ({ n: p.n, legibilidade: p.legibilidade })),
    campos_extraidos: extracao?.campos || {},
    assinaturas: extracao?.assinaturas || [],
    conferencias: veredito.conferencias,
    divergencias: veredito.divergencias,
    pendencias: veredito.pendencias,
    parecer: veredito.parecer,
    confianca: veredito.confianca,
    descartados: descartados || [], // auditoria: o que o verificador derrubou e por quê
    uso: uso || {},
  };
}

/** Registro canônico e auditável. Nunca derruba a análise: sem Supabase, o laudo segue no draft. */
export async function salvarLaudo(laudo, { fetchImpl = fetch } = {}) {
  if (!sbEnabled()) return { ok: false, motivo: 'sem_supabase' };
  try {
    await sbInsert('docia_laudos', {
      id: laudo.id,
      versao_motor: laudo.versao_motor,
      modelo: laudo.modelo,
      origem: laudo.origem,
      tipo_documento: laudo.tipo_documento,
      parecer: laudo.parecer,
      confianca: laudo.confianca,
      laudo: laudo, // JSONB: a fotografia inteira do que se sabia na hora
    }, fetchImpl);
    return { ok: true };
  } catch (e) {
    console.warn('[docia] salvarLaudo falhou (defensivo):', e.message);
    return { ok: false, motivo: 'erro', detalhe: e.message };
  }
}
