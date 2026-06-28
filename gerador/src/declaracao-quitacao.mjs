// declaracao-quitacao.mjs — Gerador da Declaração de Quitação de Débitos (CND).
//
// ⚠️  PESO JURÍDICO: este módulo gera um RASCUNHO. O síndico assina via Autentique.
//     A NCS NUNCA declara quitação automaticamente — é sempre rascunho para revisão humana.
//
// Gate CONSERVADOR (Lei 12.007/09 + regra do projeto "0 boleto ≠ quitado"):
//   - Qualquer dúvida → NÃO gera. Só gera quando get_inadimplencia confirmar SEM_DEBITO E SEM jurídico.
//   - Garantidoras tipo 'total' e Flores (id 182, cego ao token) → NÃO gera.
//
// Exporta: gerarDeclaracaoQuitacao({ id_condominio, id_unidade, dataPosicao? }, deps?)
// deps = { getInadimplencia, isGarantidora } — injeção de dependência para testes sem API real.

import path from 'node:path';
import url from 'node:url';
import fs from 'node:fs';
import { renderDeclaracaoHTML } from './template-cnd.mjs';
import { htmlParaPdf } from './render-pdf.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const RAIZ_GERADOR = path.dirname(__dirname); // .../gerador/

// ---- Helpers de data -------------------------------------------------------

const MESES = ['janeiro','fevereiro','março','abril','maio','junho',
                'julho','agosto','setembro','outubro','novembro','dezembro'];

function dataExtenso(d) {
  // Aceita Date ou string ISO/DD-MM-YYYY. Retorna "26 de junho de 2026".
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) {
    // Tenta parsear "DD/MM/YYYY" ou "DD-MM-YYYY"
    const m = String(d).match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
    if (m) return `${parseInt(m[1], 10)} de ${MESES[parseInt(m[2], 10) - 1]} de ${m[3]}`;
    return String(d); // fallback verbatim
  }
  // Forçar fuso local (evita UTC -3 virar dia anterior)
  const dia = dt.getUTCDate();
  const mes = MESES[dt.getUTCMonth()];
  const ano = dt.getUTCFullYear();
  return `${dia} de ${mes} de ${ano}`;
}

function dataHoje() {
  const now = new Date();
  // Usar horário de Brasília: UTC-3
  const br = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  return `${br.getDate()} de ${MESES[br.getMonth()]} de ${br.getFullYear()}`;
}

// ---- Importações dinâmicas das funções reais da Ana (lazy, para DI em testes) -----

let _realDeps = null;
async function getRealDeps() {
  if (_realDeps) return _realDeps;
  // Importa de ../src/ (Ana) — nunca copia, nunca edita.
  const sl = await import('../../src/superlogica.mjs');
  const gar = await import('../../src/garantidora.mjs');
  _realDeps = {
    getInadimplencia: sl.get_inadimplencia,
    // isGarantidora: retorna o registro do condomínio se for garantidora tipo 'total' (inclui Flores 182).
    //   Allure (tipo 'allure') NÃO bloqueia a CND — a NCS gera boleto normal pra eles.
    isGarantidora: ({ id_condominio }) => {
      const r = gar.consultar_garantidora({ id_condominio });
      return r.tem && r.tipo === 'total';
    },
    // getDadosCondo: resolve nome+endereço+cidade do condo via Superlógica.
    //   Tenta resolver_cadastro (dados de unidade) para obter o nome do condomínio e,
    //   combinado com condominios/get para o endereço quando disponível.
    //   Exposto como dep separada para facilitar mock no teste.
    getDadosCondo: sl.resolver_cadastro,
    // getCondoDetalhes: lista todos os condos (cache) para pegar nome+endereço por id.
    //   A resolver_cadastro precisa de CPF/tel/nome — para a CND só temos id_condominio+id_unidade.
    //   Usamos o endpoint condominios/get via importação auxiliar abaixo.
    _slGet: null, // preenchido abaixo
  };
  // Importa slGet interno (não exportado) via workaround: reusar listCondominios indiretamente.
  // Como a Ana não exporta slGet diretamente, chamamos get_inadimplencia com um id inexistente
  // apenas para forçar a inicialização do cache — não. Melhor: importar config e chamar diretamente.
  const { config } = await import('../../src/config.mjs');
  _realDeps._slGetCondo = async (id_condominio) => {
    const qs = new URLSearchParams({ id: id_condominio }).toString();
    const url = `${config.slBase}/condominios/get?${qs}`;
    const r = await fetch(url, {
      headers: {
        app_token: config.slApp,
        access_token: config.slAccess,
        'Content-Type': 'application/json',
      },
    });
    if (!r.ok) throw new Error(`Superlógica condominios/get ${r.status}`);
    return r.json();
  };
  return _realDeps;
}

// ---- getDadosCondominio: resolve nome+endereço do condo (anti-alucinação) -------

async function getDadosCondominio(id_condominio, _slGetCondo) {
  // condominios/get?id=<id> retorna array com 1 item (ou lista se id=-1).
  let rows;
  try { rows = await _slGetCondo(id_condominio); } catch (e) { return null; }
  const row = (Array.isArray(rows) ? rows : []).find(
    (c) => String(c.id_condominio_cond || c.id) === String(id_condominio)
  );
  if (!row) return null;
  const nome = row.st_fantasia_cond || row.st_nome_cond || null;
  const endereco = [
    row.st_logradouro_cond,
    row.st_numero_cond ? `nº ${row.st_numero_cond}` : null,
    row.st_complemento_cond || null,
    row.st_bairro_cond || null,
  ].filter(Boolean).join(', ') || row.st_endereco_cond || null;
  // st_estado_cond às vezes vem como código numérico (ex "25") em vez da sigla → só usa se for 2 letras
  const ufRaw = String(row.st_estado_cond || '').trim();
  const uf = /^[A-Za-z]{2}$/.test(ufRaw) ? ufRaw.toUpperCase() : '';
  const cidade = String(row.st_cidade_cond || '').trim();
  const cidade_uf = (cidade && uf) ? `${cidade} / ${uf}` : (cidade || uf || null);
  return nome ? { nome, endereco: endereco || '', cidade_uf: cidade_uf || '' } : null;
}

// ---- getIdentificacaoUnidade: identificação textual da unidade (bloco/apto) -----
// Usa inadimplencia/index ou responsaveis/index — aqui optamos por usar o campo
// identificacao que a resolver_cadastro já monta. Para CND, passamos id_unidade
// e esperamos que o campo de texto já venha do chamador (ou buscamos no Superlógica).
// Para manter simples sem precisar de CPF: buscamos em responsaveis/index do condo.

async function getIdentificacaoUnidade(id_condominio, id_unidade, _slGetCondo) {
  // Tenta condominios/get só para nomear — a unidade vem pelo id_unidade.
  // Como responsaveis/index exige idCondominio (não exportado diretamente aqui),
  // retornamos uma string segura baseada no id_unidade. O chamador pode
  // passar id_unidade já como texto "Bloco A / Apto 12" se souber.
  // Formato padrão: "Unidade <id_unidade>"
  return `Unidade ${id_unidade}`;
}

// ---- Principal ---------------------------------------------------------------

/**
 * gerarDeclaracaoQuitacao({ id_condominio, id_unidade, dataPosicao?, identificacaoUnidade? }, deps?)
 *
 * @param {object} params
 *   id_condominio        - id do condomínio no Superlógica
 *   id_unidade           - id da unidade no Superlógica
 *   dataPosicao          - (opcional) string ou Date; padrão = hoje em PT-BR
 *   identificacaoUnidade - (opcional) texto livre ("Bloco A / Apto 12"); padrão = "Unidade <id>"
 *
 * @param {object} deps  - injeção de dependência (para testes sem API real)
 *   getInadimplencia({ id_condominio, id_unidade }) → Promise<{ status, qtd_cobrancas_em_aberto?, no_juridico? }>
 *   isGarantidora({ id_condominio })                → boolean (true = bloqueia)
 *   getDadosCondominio(id_condominio, ...)           → Promise<{ nome, endereco, cidade_uf } | null>
 *   getIdentificacaoUnidade(...)                     → Promise<string>
 *
 * @returns Promise<{ ok:true, destino, dados } | { ok:false, motivo }>
 */
export async function gerarDeclaracaoQuitacao(
  { id_condominio, id_unidade, dataPosicao, identificacaoUnidade, tipo = 'oficial' } = {},
  deps = {}
) {
  if (!id_condominio || !id_unidade) {
    return { ok: false, motivo: 'parametros_invalidos', detalhe: 'id_condominio e id_unidade são obrigatórios' };
  }

  // Resolve deps reais (lazy) se não injetadas
  const real = await getRealDeps().catch(() => null);

  const _isGarantidora = deps.isGarantidora ?? (real ? real.isGarantidora : () => false);
  const _getInadimplencia = deps.getInadimplencia ?? (real ? real.getInadimplencia : null);
  const _getDadosCondominio = deps.getDadosCondominio ?? (
    real && real._slGetCondo
      ? (id) => getDadosCondominio(id, real._slGetCondo)
      : async () => null
  );
  const _getIdUnidade = deps.getIdentificacaoUnidade ?? (
    async () => getIdentificacaoUnidade(id_condominio, id_unidade, null)
  );

  // ----- GATE 1: Garantidora tipo 'total' (inclui Flores 182) -----
  let bloqueadoGarantidora = false;
  try { bloqueadoGarantidora = _isGarantidora({ id_condominio }); } catch { bloqueadoGarantidora = true; }
  if (bloqueadoGarantidora) {
    return { ok: false, motivo: 'garantidora_ou_cego', detalhe: 'Condomínio gerido por garantidora externa ou cego ao token — NCS não verifica adimplência. Encaminhar ao canal da garantidora.' };
  }

  // ----- GATE 2: Adimplência via get_inadimplencia -----
  if (!_getInadimplencia) {
    return { ok: false, motivo: 'indisponivel', detalhe: 'Módulo de inadimplência não disponível.' };
  }

  let inadResult;
  try { inadResult = await _getInadimplencia({ id_condominio, id_unidade }); }
  catch { return { ok: false, motivo: 'indisponivel', detalhe: 'Erro ao consultar inadimplência no Superlógica.' }; }

  if (!inadResult) {
    return { ok: false, motivo: 'indisponivel', detalhe: 'Resposta vazia da consulta de inadimplência.' };
  }

  // status='gerido_por_garantidora' também bloqueia (get_inadimplencia já retorna isso)
  if (inadResult.status === 'gerido_por_garantidora') {
    return { ok: false, motivo: 'garantidora_ou_cego', detalhe: 'Cobrança gerida por garantidora externa.' };
  }

  if (inadResult.status === 'indisponivel') {
    return { ok: false, motivo: 'indisponivel', detalhe: 'Superlógica indisponível no momento — não é possível confirmar adimplência. Tente novamente mais tarde.' };
  }

  if (inadResult.status === 'inadimplente') {
    return { ok: false, motivo: 'inadimplente', qtd_cobrancas_em_aberto: inadResult.qtd_cobrancas_em_aberto, detalhe: `Unidade possui ${inadResult.qtd_cobrancas_em_aberto ?? 'débitos'} cobranças em aberto.` };
  }

  // no_juridico: pode vir em qualquer status (defensivo)
  if (inadResult.no_juridico) {
    return { ok: false, motivo: 'no_juridico', qtd_processos: inadResult.qtd_processos, detalhe: 'Unidade com processo judicial em aberto — CND não pode ser emitida. Encaminhar ao jurídico.' };
  }

  // Só chega aqui se status === 'sem_debito_vencido' E !no_juridico
  if (inadResult.status !== 'sem_debito_vencido') {
    // status desconhecido → conservador: NÃO gera
    return { ok: false, motivo: 'indisponivel', detalhe: `Status inesperado da inadimplência: ${inadResult.status}` };
  }

  // ----- COLETA DE DADOS (anti-alucinação — tudo do Superlógica) -----
  const dataPos = dataPosicao ? dataExtenso(dataPosicao) : dataHoje();

  let condoDados;
  try { condoDados = await _getDadosCondominio(id_condominio); } catch { condoDados = null; }
  if (!condoDados || !condoDados.nome) {
    return { ok: false, motivo: 'dado_ausente', detalhe: 'Não foi possível obter nome do condomínio no Superlógica. Abortando para evitar alucinação.' };
  }

  let unidadeTexto;
  try { unidadeTexto = identificacaoUnidade || await _getIdUnidade(); }
  catch { unidadeTexto = `Unidade ${id_unidade}`; }

  // ----- RENDER + PDF -----
  const html = renderDeclaracaoHTML({
    condominio: condoDados,
    unidade: unidadeTexto,
    dataPosicao: dataPos,
    tipo,
  });

  const saidaDir = path.join(RAIZ_GERADOR, 'saida');
  fs.mkdirSync(saidaDir, { recursive: true });

  const nomeArq = `cnd_${tipo}_condo${id_condominio}_uni${id_unidade}_${dataPos.replace(/\s+de\s+/g, '-')}.pdf`;
  const destino = path.join(saidaDir, nomeArq);

  try { htmlParaPdf(html, destino); }
  catch (e) { return { ok: false, motivo: 'erro_pdf', detalhe: e.message }; }

  return {
    ok: true,
    destino,
    dados: {
      condominio: condoDados,
      unidade: unidadeTexto,
      dataPosicao: dataPos,
      id_condominio,
      id_unidade,
    },
  };
}
