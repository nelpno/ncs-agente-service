// cadastro_inquilino.mjs — WriteAction #1. Cadastra inquilino/residente ou dependente numa unidade.
import { registerAction } from '../registry.mjs';
import { responsaveisIndex as _respIndex } from '../../superlogica.mjs';
import { slPut as _slPut } from '../../superlogica_write.mjs';
import { enfileirarAvisos } from '../../outbox.mjs';

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

async function checarConflito(ctx, d, io = {}) {
  const atuais = await snapshot(ctx, d, io);
  const candidatos = atuais.filter((c) =>
    (d.cpf && String(c.st_cpfcnpj_con || '').replace(/\D/g, '') === String(d.cpf).replace(/\D/g, '')) ||
    (!d.cpf && norm(c.st_nome_con) === norm(d.nome))
  );
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
      candidatosId = depois.filter((c) =>
        (dados.cpf && String(c.st_cpfcnpj_con || '').replace(/\D/g, '') === String(dados.cpf).replace(/\D/g, '')) ||
        norm(c.st_nome_con) === norm(dados.nome)
      ).map((c) => c.id_contato_con);
      idCriado = candidatosId.length === 1 ? candidatosId[0] : null;
    } catch {}
  }
  return { ok: true, dryRun: !!res.dryRun, resposta: res.resposta, idCriado, candidatosId };
}

// Frase única que o aprovador lê antes de decidir. Mora AQUI (na ação) porque é a ação que conhece
// a semântica; o painel do piloto e o card do Portal só exibem — nenhum dos dois remonta a regra.
function resumir(d) {
  const papel = d.papel === 'dependente' ? 'dependente' : 'inquilino';
  const quem = inquilinoRecebe(d)
    ? 'O boleto da taxa passa a ir para ele (o proprietário fica só com as cobranças extras).'
    : 'O boleto da taxa continua indo para o proprietário.';
  return `${d.nome} entra como ${papel} da unidade ${d.id_unidade} a partir de ${d.data_entrada}. ${quem}`;
}

function render(d, snap) {
  const recebe = inquilinoRecebe(d);
  return {
    resumo: resumir(d),
    campos: [
      { label: 'Condomínio', valor: d.id_condominio },
      { label: 'Unidade', valor: d.id_unidade },
      { label: 'Nome', valor: d.nome },
      { label: 'Papel', valor: d.papel === 'dependente' ? 'Dependente' : 'Inquilino/Residente' },
      { label: 'Entrada', valor: d.data_entrada },
      { label: 'E-mail', valor: d.email || '—' },
      { label: 'Telefone', valor: d.telefone || '—' },
      { label: 'CPF', valor: d.cpf || '—' },
      { label: 'Quem recebe o boleto', valor: recebe ? 'O inquilino (responsável pela cobrança)' : 'O proprietário (padrão)' },
    ],
    diff: [{ tipo: 'add', texto: `+ novo contato "${d.nome}" na unidade ${d.id_unidade}` }],
    // alertas — o que o aprovador precisa FAZER e a Ana não faz sozinha. O flip do proprietário
    // (1 → 2 "só extras") é uma 2ª escrita, num contato que já existe: fica com o humano nesta onda.
    // Sem ele, proprietário e inquilino recebem a MESMA taxa (duplicação).
    alertas: recebe ? [
      `Ao aprovar, mude o proprietário da unidade ${d.id_unidade} para "só cobranças extras" no Superlógica — sem isso o boleto da taxa sai para o proprietário E para o inquilino (duplicado).`,
    ] : [],
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
      ator: { nome: dados.nome, papel: dados.papel || 'inquilino', unidade: dados.unidade_label, telefone: dados.telefone },
      draftId: dados.__draftId || null,
    });
    return { aviso };
  } catch (e) {
    console.warn('[cadastro_inquilino] posGravar falhou (defensivo, não derruba a gravação):', e.message);
    return { aviso: { ok: false, motivo: 'erro_posgravar', detalhe: e.message, enfileirados: 0, pendente_humano: 0 } };
  }
}

Object.assign(cadastroInquilino, { checarConflito, snapshot, gravar, render, posGravar });
