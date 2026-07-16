// cadastro_inquilino.mjs — WriteAction #1. Cadastra inquilino/residente ou dependente numa unidade.
import { registerAction } from '../registry.mjs';
import { responsaveisIndex as _respIndex } from '../../superlogica.mjs';
import { slPut as _slPut } from '../../superlogica_write.mjs';
import { enfileirarAvisos } from '../../outbox.mjs';
import { STATUS } from '../../docia/conferir.mjs';

const DATA_RE = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/; // MM/DD/AAAA

// ID_TIPORESP_TRES — quem recebe a cobrança. A doc oficial (pág.26) lista só 1/2/4 e OMITE o 7,
// que é o valor que a NCS de fato usa. Medido em 25 condos / 3.330 responsáveis ativos
// (.tmp/superlogica_tiporesp_{unidade,confound,prova,valores}.mjs, 14/07):
//   · inquilino NÃO responsável → 4, com o proprietário em 1 — 416/416 unidades
//   · inquilino É   responsável → 7, com o proprietário em 2 ("só extras") — 140/140 unidades
//   · inquilino com 1: 0 de 872 → escrever 1 (como dizia o plano) inventaria estado inexistente
//   · 0 unidades com inquilino=7 E proprietário=1 → sem o flip do proprietário os DOIS recebem a
//     taxa normal (a duplicação que o Fernando quis evitar). Por isso o render alerta o aprovador:
//     o flip é uma 2ª escrita, num contato que JÁ existe, e não sai daqui (ver render/alertas).
const TIPORESP_NAO_RECEBE = '4';
const TIPORESP_INQUILINO_RESPONSAVEL = '7';
const RESPONSAVEIS = ['proprietario', 'inquilino'];

// nomes EXATOS dos campos opcionais a confirmar em descoberta/api-superlogica-doc.md (pág 26-27)
const MAP_OPCIONAIS = {
  email: 'contatos[0][ST_EMAIL_CON]',
  telefone: 'contatos[0][ST_TELEFONE_CON]',
  cpf: 'contatos[0][ST_CPFCNPJ_CON]',
};

function validar(d) {
  const erros = [];
  for (const k of ['id_condominio', 'id_unidade', 'nome', 'data_entrada']) if (!d?.[k]) erros.push(`faltou ${k}`);
  // CPF do inquilino — Fernando, 15/07: "o CPF, para gerar o boleto da taxa de condomínio... sem o
  // CPF a gente não consegue gerar". Sem ele o cadastro ENTRA e não serve para nada: a equipe não
  // emite o boleto e o caso volta. Travar aqui faz a Ana pedir, em vez de mandar para a fila um
  // rascunho natimorto. Dependente não recebe cobrança (141/141 no dado real) → não precisa.
  // ⚠️ e-mail e telefone NÃO travam de propósito: o Fernando graduou os três ("o telefone não era
  // muito necessário"), e exigir o que o motor não precisa é o que travou o Estagiário em 14/07.
  // Eles viram ALERTA no card (ver render) — visíveis para o aprovador, sem bloquear o atendimento.
  if (d?.papel !== 'dependente' && !d?.cpf) erros.push('faltou cpf (sem ele a equipe não gera o boleto da taxa)');
  if (d?.papel && !['inquilino', 'dependente'].includes(d.papel)) erros.push('papel inválido');
  if (d?.data_entrada && !DATA_RE.test(d.data_entrada)) erros.push('data_entrada deve ser MM/DD/AAAA');
  if (d?.responsavel_cobranca && !RESPONSAVEIS.includes(d.responsavel_cobranca)) erros.push('responsavel_cobranca inválido');
  // dependente nunca recebe cobrança (141/141 no dado real) — pedir isso é erro de coleta, não um caso raro
  if (d?.papel === 'dependente' && d?.responsavel_cobranca === 'inquilino') erros.push('dependente não pode ser o responsável pela cobrança');
  return { ok: erros.length === 0, erros };
}

const inquilinoRecebe = (d) => d?.papel !== 'dependente' && d?.responsavel_cobranca === 'inquilino';

function montarPayload(d) {
  const p = {
    idCondominio: String(d.id_condominio),
    idUnidade: String(d.id_unidade),
    'contatos[0][ST_NOME_CON]': d.nome,
    'contatos[0][DT_ENTRADA_RES]': d.data_entrada,
    'contatos[0][ID_LABEL_TRES]': d.papel === 'dependente' ? '4' : '7',
    'contatos[0][ID_TIPORESP_TRES]': inquilinoRecebe(d) ? TIPORESP_INQUILINO_RESPONSAVEL : TIPORESP_NAO_RECEBE,
    'contatos[0][ID_TIPOCONTATO_TCON]': '1', // condômino
  };
  for (const [campo, chave] of Object.entries(MAP_OPCIONAIS)) if (d[campo]) p[chave] = d[campo];
  return p;
}

export const cadastroInquilino = {
  id: 'cadastro_inquilino',
  descricao: 'Cadastrar inquilino/residente ou dependente numa unidade',
  titulo: 'Cadastro de inquilino', // cabeçalho na tela do aprovador (o `id` é enum de banco, não texto)
  timeAprovador: 'Recepção',
  validar,
  montarPayload,
};
registerAction(cadastroInquilino);

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '').trim();

async function snapshot(ctx, d, io = {}) {
  const respIndex = io.responsaveisIndex || _respIndex;
  return respIndex(d.id_condominio, d.id_unidade);
}

// CPF de um contato como a API DEVOLVE. ⚠️ `responsaveis/index` retorna `st_cpf_con` — NÃO
// `st_cpfcnpj_con`, que era o campo lido aqui e simplesmente não existe na resposta (medido no
// snapshot real da unidade 4457/Allure em 16/07). Ler campo inexistente = comparação sempre falsa,
// calada. O `st_cpfcnpj_con` fica no fallback porque é o nome usado na ESCRITA (contatos[0][ST_CPFCNPJ_CON]) —
// a API do Superlógica é assimétrica entre ler e gravar, e um endpoint futuro pode devolvê-lo.
const cpfDoContato = (c) => String(c?.st_cpf_con || c?.st_cpfcnpj_con || '').replace(/\D/g, '');
const soDigitos = (s) => String(s || '').replace(/\D/g, '');

// "Já existe alguém assim nesta unidade?" — CPF igual OU nome igual. Os dois, não um ou outro:
// ⚠️ o `||` do nome NÃO pode ser condicionado a `!d.cpf` (era assim até 16/07). Quando o CPF virou
// obrigatório (0103794, 15/07), essa condição passou a ser sempre falsa e a busca por nome MORREU —
// junto com a comparação por CPF, que já lia o campo errado. Resultado: conflito nunca detectado, e
// a Ana criaria um contato DUPLICADO da mesma pessoa, em silêncio. Provado com o dado real: Bruno
// Muller já cadastrado na unidade (CPF 414…), e nem o CPF certo nem o nome o encontravam.
// O CPF do cadastro pode estar vazio/desatualizado (o do morador na conversa é o atual) → por isso o
// nome também vale, e por isso o CPF só conta quando existe DOS DOIS LADOS.
async function checarConflito(ctx, d, io = {}) {
  const atuais = await snapshot(ctx, d, io);
  const cpfInformado = soDigitos(d.cpf);
  const candidatos = atuais.filter((c) => {
    const cpfCadastro = cpfDoContato(c);
    const mesmoCpf = !!cpfInformado && !!cpfCadastro && cpfCadastro === cpfInformado;
    const mesmoNome = norm(c.st_nome_con) === norm(d.nome);
    return mesmoCpf || mesmoNome;
  });
  return { conflito: candidatos.length > 0, detalhe: candidatos.length ? 'já existe contato semelhante na unidade' : '', candidatos };
}

async function gravar(payload, { dados, io = {} } = {}) {
  const put = io.slPut || _slPut;
  const res = await put('unidades/post', payload);
  if (!res.ok) return { ok: false, resposta: res.resposta, status: res.status };
  // ID do contato criado é indocumentado → reler e casar (match não único → registra candidatos, não adivinha)
  let idCriado = null, candidatosId = [];
  if (!res.dryRun && dados) {
    try {
      const depois = await (io.responsaveisIndex || _respIndex)(dados.id_condominio, dados.id_unidade);
      const cpfInformado = soDigitos(dados.cpf);
      candidatosId = depois.filter((c) => {
        const cpfCadastro = cpfDoContato(c); // st_cpf_con — ver nota em checarConflito
        return (!!cpfInformado && !!cpfCadastro && cpfCadastro === cpfInformado)
          || norm(c.st_nome_con) === norm(dados.nome);
      }).map((c) => c.id_contato_con);
      idCriado = candidatosId.length === 1 ? candidatosId[0] : null;
    } catch {}
  }
  return { ok: true, dryRun: !!res.dryRun, resposta: res.resposta, idCriado, candidatosId };
}

// Como a unidade aparece p/ HUMANO. `id_unidade` é chave de banco (14381): o aprovador não acha isso
// no Superlógica, e o Fernando já reportou esse vazamento uma vez (CND com "unidade 997").
// O rótulo vem do ERP (resolver_cadastro → unidades[].identificacao, ex. "QUADRA 20 / LOTE 0314"),
// carregado no draft pela tool — nunca escrito pelo LLM. Sem rótulo, cai no id (não quebra).
const unidadeVisivel = (d) => d.unidade_label || d.id_unidade;
// A API do Superlógica exige MM/DD/AAAA; o texto para gente é DD/MM/AAAA. Só exibição — o payload
// (DT_ENTRADA_RES) continua no formato da API.
const dataBR = (s) => {
  const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[2]}/${m[1]}/${m[3]}` : (s || '—');
};

// Frase única que o aprovador lê antes de decidir. Mora AQUI (na ação) porque é a ação que conhece
// a semântica; o painel do piloto e o card do Portal só exibem — nenhum dos dois remonta a regra.
function resumir(d) {
  const papel = d.papel === 'dependente' ? 'dependente' : 'inquilino';
  const quem = inquilinoRecebe(d)
    ? 'O boleto da taxa passa a ir para ele (o proprietário fica só com as cobranças extras).'
    : 'O boleto da taxa continua indo para o proprietário.';
  return `${d.nome} entra como ${papel} da unidade ${unidadeVisivel(d)} a partir de ${dataBR(d.data_entrada)}. ${quem}`;
}

// ── DocIA (Fase 0): a conferência do contrato no card ─────────────────────────────────────────────
// INFORMATIVA: não bloqueia o botão nem decide nada — quem aprova é a pessoa. Sem laudo (a maioria dos
// casos: nem todo cadastro vem com contrato, e com a flag desligada nunca vem) o card fica IDÊNTICO ao
// de hoje — é o que torna esta mudança segura de deployar antes do ensaio.
//
// ⚠️ Check verde NÃO entra em `alertas[]`. Aquele canal significa "atenção, faça isto"; enchê-lo de OK
// ensina o aprovador a passar o olho por cima — e aí ele perde o alerta que importa (o flip do
// proprietário, que evita boleto duplicado). Os OK viram UMA linha em `campos[]`; em `alertas[]`, só o
// que falhou. Mesma lição da pendência fantasma: ruído no canal de atenção mata o canal.
// ⚠️ `confianca` NÃO vai para a tela: é número sem calibração (a régua ainda não foi medida com dado
// real) e número na tela lê como certeza. Fica no laudo, para calibrar depois.
function linhasDocia(l) {
  if (!l) return { selo: '', campo: null, alertas: [] };
  const conf = l.conferencias || [];
  const oks = conf.filter((c) => c.status === STATUS.OK).length;
  const naoVerif = conf.filter((c) => c.status === STATUS.NAO_VERIF).length;
  const falhas = [...(l.divergencias || []), ...(l.pendencias || [])];
  const selo = l.parecer === 'aprovado' ? 'sem pendências'
    : l.parecer === 'reprovado' ? 'REPROVADO — confira o documento antes de aprovar'
    // O documento está certo, mas é de OUTRO fluxo (ex.: compra e venda pedindo titularidade). Não é
    // "reprovado" — o morador acertou o papel; é o pedido que não é cadastro de inquilino.
    : l.parecer === 'outro_assunto' ? 'este documento é de outro assunto (titularidade) — não é cadastro de inquilino'
    : `${falhas.length} ${falhas.length === 1 ? 'item' : 'itens'} a resolver`;
  // "não verificável" é dito em voz alta: silenciar vira "ok por omissão" — o que o motor recusa fazer.
  const detalhe = [`✔ ${oks} ${oks === 1 ? 'conferência OK' : 'conferências OK'}`,
    naoVerif ? `${naoVerif} não verificável(is)` : null].filter(Boolean).join(' · ');
  return {
    selo: ` · Contrato conferido: ${selo}.`,
    campo: { label: 'Conferência do contrato (DocIA)', valor: `${selo} — ${detalhe}` },
    alertas: falhas.map((f) => `Contrato: ${f}`),
  };
}

function render(d, snap) {
  const recebe = inquilinoRecebe(d);
  const doc = linhasDocia(d.laudo);
  return {
    resumo: resumir(d) + doc.selo,
    campos: [
      { label: 'Condomínio', valor: d.condominio_nome || d.id_condominio },
      { label: 'Unidade', valor: unidadeVisivel(d) },
      { label: 'Nome', valor: d.nome },
      { label: 'Papel', valor: d.papel === 'dependente' ? 'Dependente' : 'Inquilino/Residente' },
      { label: 'Entrada', valor: dataBR(d.data_entrada) },
      { label: 'E-mail', valor: d.email || '—' },
      { label: 'Telefone', valor: d.telefone || '—' },
      { label: 'CPF', valor: d.cpf || '—' },
      { label: 'Quem recebe o boleto', valor: recebe ? 'O inquilino (responsável pela cobrança)' : 'O proprietário (padrão)' },
      ...(doc.campo ? [doc.campo] : []),
    ],
    diff: [{ tipo: 'add', texto: `+ novo contato "${d.nome}" na unidade ${unidadeVisivel(d)}` }],
    // alertas — o que o aprovador precisa FAZER e a Ana não faz sozinha. O flip do proprietário
    // (1 → 2 "só extras") é uma 2ª escrita, num contato que já existe: fica com o humano nesta onda.
    // Sem ele, proprietário e inquilino recebem a MESMA taxa (duplicação).
    // O flip vem PRIMEIRO: é ação de escrita; o do contrato é conferência de papel.
    alertas: [
      ...(recebe ? [`Ao aprovar, mude o proprietário da unidade ${unidadeVisivel(d)} para "só cobranças extras" no Superlógica — sem isso o boleto da taxa sai para o proprietário E para o inquilino (duplicado).`] : []),
      // Dado que falta e a equipe precisa buscar — é ação, por isso é alerta e não campo vazio.
      // O CPF não aparece aqui porque nem chega: `validar` barra antes (a Ana pede no atendimento).
      ...(!d.email ? ['Sem e-mail: é para onde o boleto é enviado — peça antes de aprovar.'] : []),
      ...(!d.telefone ? ['Sem telefone: é o contato que entra no sistema da portaria.'] : []),
      ...doc.alertas,
    ],
    snapshotResumo: `${(snap || []).length} contato(s) hoje na unidade`,
  };
}

// posGravar — side-effects APÓS o cadastro gravar. Enfileira o aviso no outbox (spec Onda 1 §4.3); não envia
// aqui, só grava a pendência (o worker do outbox entrega). Precisa do NOME do condomínio (dados.condominio_nome,
// informado pela Ana) — sem nome, o plano fica sem resolver e o outbox devolve enfileirados:0.
// ⚠️ draftId: o engine chama posGravar(dados,{dryRun}) SEM passar o id do draft (piloto) → dados.__draftId
// fica undefined/null na prática; a linha em `notificacoes` nasce com draft_id:null. Documentado, não é bug —
// vira relevante quando o Portal quiser cruzar notificação↔draft (Onda futura).
// Async e defensivo: o engine.mjs já embrulha posGravar em try/catch, mas nunca deve lançar por conta própria.
async function posGravar(dados) {
  try {
    const aviso = await enfileirarAvisos({
      evento: 'cadastro',
      condominio: dados.condominio_nome,
      ator: { nome: dados.nome, papel: dados.papel || 'inquilino', unidade: dados.unidade_label, telefone: dados.telefone, data: dados.data_entrada },
      draftId: dados.__draftId || null,
    });
    return { aviso };
  } catch (e) {
    console.warn('[cadastro_inquilino] posGravar falhou (defensivo, não derruba a gravação):', e.message);
    return { aviso: { ok: false, motivo: 'erro_posgravar', detalhe: e.message, enfileirados: 0, pendente_humano: 0 } };
  }
}

Object.assign(cadastroInquilino, { checarConflito, snapshot, gravar, render, posGravar });
