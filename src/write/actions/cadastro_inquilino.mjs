// cadastro_inquilino.mjs — WriteAction #1. Cadastra inquilino/residente ou dependente numa unidade.
import { registerAction } from '../registry.mjs';

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
  // checarConflito, snapshot, gravar, render → Task 9
};
registerAction(cadastroInquilino);
