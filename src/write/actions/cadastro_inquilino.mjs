// cadastro_inquilino.mjs — WriteAction #1. Cadastra inquilino/residente ou dependente numa unidade.
import { registerAction } from '../registry.mjs';
import { responsaveisIndex as _respIndex } from '../../superlogica.mjs';
import { slPut as _slPut } from '../../superlogica_write.mjs';

const DATA_RE = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/; // MM/DD/AAAA

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
  return { ok: erros.length === 0, erros };
}

function montarPayload(d) {
  const p = {
    idCondominio: String(d.id_condominio),
    idUnidade: String(d.id_unidade),
    'contatos[0][ST_NOME_CON]': d.nome,
    'contatos[0][DT_ENTRADA_RES]': d.data_entrada,
    'contatos[0][ID_LABEL_TRES]': d.papel === 'dependente' ? '4' : '7',
    'contatos[0][ID_TIPORESP_TRES]': '4', // NÃO_RECEBER (default p/ inquilino; confirmar regra contábil — spec §13#4)
    'contatos[0][ID_TIPOCONTATO_TCON]': '1', // condômino
  };
  for (const [campo, chave] of Object.entries(MAP_OPCIONAIS)) if (d[campo]) p[chave] = d[campo];
  return p;
}

export const cadastroInquilino = {
  id: 'cadastro_inquilino',
  descricao: 'Cadastrar inquilino/residente ou dependente numa unidade',
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

function render(d, snap) {
  return {
    campos: [
      { label: 'Condomínio', valor: d.id_condominio },
      { label: 'Unidade', valor: d.id_unidade },
      { label: 'Nome', valor: d.nome },
      { label: 'Papel', valor: d.papel === 'dependente' ? 'Dependente' : 'Inquilino/Residente' },
      { label: 'Entrada', valor: d.data_entrada },
      { label: 'E-mail', valor: d.email || '—' },
      { label: 'Telefone', valor: d.telefone || '—' },
      { label: 'CPF', valor: d.cpf || '—' },
    ],
    diff: [{ tipo: 'add', texto: `+ novo contato "${d.nome}" na unidade ${d.id_unidade}` }],
    snapshotResumo: `${(snap || []).length} contato(s) hoje na unidade`,
  };
}

Object.assign(cadastroInquilino, { checarConflito, snapshot, gravar, render });
