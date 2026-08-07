// cobranca_parametros.mjs — juros, multa, honorários e parcelamento da cobrança, POR CONDOMÍNIO (READ-ONLY).
//
// Fonte: data/cobranca/parametros.json, gerado da planilha que o Fernando montou
// ("escrevi tudo certinho, condomínio por condomínio" — áudio de 06/08/2026).
//
// Por que este módulo existe: percentual de cobrança é DECISÃO DO CLIENTE e vira dinheiro cobrado de
// um morador. O LLM não pode inventar nem "lembrar" um valor — ele pede aqui, e aqui só sai o que a
// planilha diz. Mesma filosofia de taxa.mjs / garantidora.mjs / mudanca.mjs: dado em arquivo, tool
// devolve, modelo só redige.
//
// Três invariantes que o teste trava (test/test_cobranca_parametros.mjs):
//   1. condomínio fora da base não recebe percentual nenhum — nem "o de sempre";
//   2. condomínio que o cliente marcou como "não" devolve PARA QUEM ENCAMINHAR, não percentual;
//   3. coluna em branco na planilha = NÃO pode cobrar (falha fechada — decisão que falta é decisão que
//      não existe; assumir "pode" cobraria de um condomínio que ninguém autorizou).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// REUSO da escada de resolução de nome (substring em fronteira de palavra → tokens → singular →
// prefixo). É a MESMA que a Ana e o Estagiário usam. Escrever matcher próprio aqui foi o bug que o
// smoke em produção pegou: "Rosas de Ouro" (como o Fernando escreve) não achava "ROSA DE OURO", e
// "Salto Grande I" ficava ambíguo com o III — que na planilha têm decisão OPOSTA.
import { _filtrarCondos } from './superlogica.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'data', 'cobranca', 'parametros.json');

const norm = (s) => (s || '')
  .toLowerCase().normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
  .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

let _index = null;
/** _reloadIndex(fixture) — sem argumento (ou null) volta a ler o arquivo real; com objeto, injeta dado de teste. */
export function _reloadIndex(fixture) {
  _index = fixture ? montar(fixture) : null;
}

function montar(data) {
  const idx = [];
  for (const c of (data.condominios || [])) {
    idx.push({
      ...c,
      _norm: norm(c.nome),
      _aliasNorm: (c.aliases || []).map(norm).filter(Boolean),
    });
  }
  return idx;
}

function loadIndex() {
  if (_index) return _index;
  if (!fs.existsSync(FILE)) return (_index = []);
  try { _index = montar(JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch { _index = []; }
  return _index;
}

// Resolve o condomínio sem NUNCA escolher no chute: exato > alias > todas as palavras significativas.
// Ambiguidade legítima ("Cedros" serve para dois) continua ambígua — o mesmo critério do resto do projeto.
function resolver(idx, condominio) {
  const q = norm(condominio);
  if (!q) return { motivo: 'condominio_nao_informado' };
  const exato = idx.filter((c) => c._norm === q || c.slug === q || c._aliasNorm.includes(q));
  if (exato.length === 1) return { c: exato[0] };
  if (exato.length > 1) return { motivo: 'condominio_ambiguo', candidatos: exato.map((c) => c.nome) };

  // _filtrarCondos é um FILTRO: quando nada casa, devolve a lista inteira de volta. Só há match de
  // verdade se ele reduziu o conjunto — senão é "não achei", não "achei todos".
  const hits = _filtrarCondos(idx, condominio);
  if (!hits.length || (hits.length === idx.length && idx.length > 1)) {
    return { motivo: 'condominio_sem_parametro_cobranca' };
  }
  if (hits.length === 1) return { c: hits[0] };
  return { motivo: 'condominio_ambiguo', candidatos: hits.map((c) => c.nome) };
}

/** 0.01 -> "1%" · 0 -> "0%" · null -> null. Existe para o texto nunca mostrar "0.01%" ao morador. */
export function _percentualComoTexto(v) {
  if (v == null) return null;
  const n = Number(v) * 100;
  return `${Number.isInteger(n) ? n : Number(n.toFixed(2))}%`;
}

function resumoLiberado(c) {
  const partes = [`Em ${c.nome}, a cobrança pode ser tratada pela NCS`];
  if (c.janela_dias) partes.push(`somente até ${c.janela_dias} dias após o vencimento`);
  let t = `${partes.join(', ')}.`;
  t += ` Encargos previstos: juros de ${_percentualComoTexto(c.juros_mes)} ao mês e multa de ${_percentualComoTexto(c.multa)}.`;
  if (c.honorarios_automatico && c.honorarios_pct) {
    t += ` Honorários de ${_percentualComoTexto(c.honorarios_pct)}.`;
  } else {
    t += ' Sem honorários automáticos.';
  }
  if (c.parcelamento_max) {
    t += /vista/i.test(c.parcelamento_max)
      ? ' Pagamento somente à vista.'
      : ` Parcelamento em até ${c.parcelamento_max}.`;
  }
  return t;
}

/**
 * consultar_parametros_cobranca({ condominio })
 *
 * Devolve as condições de cobrança que o condomínio autorizou. Se o condomínio não está na base,
 * ou o cliente não autorizou, NÃO sai percentual nenhum — sai para quem encaminhar.
 *
 * ⚠️ Os valores aqui valem para a NEGOCIAÇÃO. O valor atualizado de um débito específico continua
 * vindo do Superlógica (get_inadimplencia), que já calcula encargo por boleto.
 */
export function consultar_parametros_cobranca({ condominio } = {}) {
  const idx = loadIndex();
  if (!idx.length) return { encontrou: false, motivo: 'base_cobranca_vazia' };

  const { c, motivo, candidatos } = resolver(idx, condominio);
  if (!c) {
    return {
      encontrou: false,
      motivo, // condominio_nao_informado | condominio_sem_parametro_cobranca | condominio_ambiguo
      condominio_pedido: condominio || null,
      ...(candidatos ? { candidatos } : {}),
    };
  }

  // Bloqueado (ou sem decisão): devolve o caminho, nunca o percentual.
  if (c.pode_cobrar !== true) {
    const para = c.judicial_responsavel || c.responsavel || null;
    return {
      encontrou: true,
      condominio: c.nome,
      pode_cobrar: false,
      motivo_bloqueio: c.pode_cobrar === false ? 'nao_autorizado_pelo_condominio' : 'sem_decisao_na_planilha',
      encaminhar_para: para,
      contato_externo: c.contato_externo || null,
      resumo: para
        ? `Em ${c.nome} a cobrança não é feita pela NCS: quem conduz é ${para}. Encaminhe o morador para esse contato.`
        : `Em ${c.nome} ainda não há definição de quem conduz a cobrança. Confirme com a equipe antes de tratar valores.`,
    };
  }

  return {
    encontrou: true,
    condominio: c.nome,
    pode_cobrar: true,
    janela_dias: c.janela_dias ?? null,
    juros_mes: c.juros_mes,
    multa: c.multa,
    honorarios_automatico: c.honorarios_automatico === true,
    honorarios_pct: c.honorarios_pct,
    parcelamento_max: c.parcelamento_max || null,
    responsavel: c.responsavel || null,
    resumo: resumoLiberado(c),
  };
}
