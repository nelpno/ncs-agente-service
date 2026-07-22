// titularidade.mjs — WriteAction #2 (Onda C). Troca de titularidade (compra e venda): cadastra o NOVO
// proprietário e dá DATA DE SAÍDA no(s) proprietário(s) atual(is), que ficam INATIVOS no histórico
// (Fernando 21/07: "o contato antigo fica inativo, não apaga"). DUAS escritas — gravar() faz as duas.
//
// ⚠️ RAIO-X (22/07, cobaia Gustavo Mascioli / Tríade condo 152, id_contato 51050): o campo de inativação
// é DT_SAIDA_RES (vazio no responsável ATIVO; visto em responsaveis/index). A doc oficial NÃO documenta a
// ESCRITA de DT_SAIDA_RES p/ contato de unidade (só DT_SAIDA_SIN, do síndico) → o payload de saída abaixo
// é o MELHOR PALPITE (unidades/post + ID_CONTATO_CON + DT_SAIDA_RES) e PRECISA ser validado no TESTE
// CONTROLADO da ativação (env WRITE_REAL_ACTIONS). Em DRY_RUN o slPut só ecoa o payload — zero risco.
//
// NÃO importada por agent.mjs ainda (sem tool `criar_rascunho_titularidade` = dormante em prod). O teste
// importa direto (registra + exercita). Onda C liga a tool + sai do DRY por ação.
import { registerAction } from '../registry.mjs';
import { responsaveisIndex as _respIndex } from '../../superlogica.mjs';
import { slPut as _slPut } from '../../superlogica_write.mjs';

const DATA_RE = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/; // MM/DD/AAAA (formato da API Superlógica)
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '').trim();
const soDigitos = (s) => String(s || '').replace(/\D/g, '');
const cpf2 = (s) => { const d = soDigitos(s); return d ? '…' + d.slice(-2) : ''; }; // LGPD: só os 2 últimos no card

function validar(d) {
  const erros = [];
  for (const k of ['id_condominio', 'id_unidade', 'nome', 'data_transferencia']) if (!d?.[k]) erros.push(`faltou ${k}`);
  // CPF do NOVO proprietário: é ele que passa a receber o boleto da taxa — sem CPF a equipe não gera.
  if (!d?.cpf) erros.push('faltou cpf do novo proprietário (sem ele a equipe não gera o boleto da taxa)');
  if (d?.data_transferencia && !DATA_RE.test(d.data_transferencia)) erros.push('data_transferencia deve ser MM/DD/AAAA');
  // proprietarios_atuais = quem SAI (lido do ERP pela tool, não pelo LLM). Sem isso não há troca: seria
  // só um proprietário A MAIS, deixando o antigo ativo — a DUPLICAÇÃO de boleto que a troca deve evitar.
  if (!Array.isArray(d?.proprietarios_atuais) || d.proprietarios_atuais.length === 0) {
    erros.push('faltou identificar o proprietário atual (quem sai) — a tool lê do Superlógica');
  } else if (d.proprietarios_atuais.some((p) => !p?.id_contato_con)) {
    erros.push('proprietario_atual sem id_contato_con (não dá p/ dar a saída sem o id do contato)');
  }
  return { ok: erros.length === 0, erros };
}

// UMA escrita cadastra o novo proprietário; UMA por proprietário que sai grava a data de saída.
function montarPayload(d) {
  const novo = {
    idCondominio: String(d.id_condominio), idUnidade: String(d.id_unidade),
    'contatos[0][ST_NOME_CON]': d.nome,
    'contatos[0][DT_ENTRADA_RES]': d.data_transferencia,
    'contatos[0][ID_LABEL_TRES]': '1', // proprietário
    'contatos[0][ID_TIPORESP_TRES]': '1', // recebe cobrança normal + extra (é o titular agora)
    'contatos[0][ID_TIPOCONTATO_TCON]': '1', // condômino
  };
  if (d.cpf) novo['contatos[0][ST_CPFCNPJ_CON]'] = d.cpf;
  if (d.email) novo['contatos[0][ST_EMAIL_CON]'] = d.email;
  if (d.telefone) novo['contatos[0][ST_TELEFONE_CON]'] = d.telefone;
  const saidas = (d.proprietarios_atuais || []).map((p) => ({
    idCondominio: String(d.id_condominio), idUnidade: String(d.id_unidade),
    'contatos[0][ID_CONTATO_CON]': String(p.id_contato_con),
    'contatos[0][DT_SAIDA_RES]': d.data_transferencia,
  }));
  return { novo, saidas };
}

export const titularidade = {
  id: 'titularidade',
  descricao: 'Trocar a titularidade de uma unidade (compra e venda): cadastra o novo proprietário e dá saída no antigo',
  titulo: 'Troca de titularidade', // cabeçalho na tela do aprovador
  timeAprovador: 'Recepção',
  validar,
  montarPayload,
};
registerAction(titularidade);

// Extrai os PROPRIETÁRIOS ATUAIS (quem sai numa troca) de responsaveis/index: id_label_tres 1/2
// (proprietário) e SEM data de saída (ativo — raio-x 22/07: dt_saida_res vazio = ativo). Exportado p/ a
// tool `criar_rascunho_titularidade` preencher `proprietarios_atuais` do ERP, NUNCA do LLM (anti-alucinação).
export function extrairProprietariosAtuais(contatos = []) {
  return (contatos || [])
    .filter((c) => ['1', '2'].includes(String(c.id_label_tres ?? '')) && !String(c.dt_saida_res || '').trim())
    .map((c) => ({ id_contato_con: c.id_contato_con, nome: c.st_nome_con, cpf: c.st_cpf_con || c.st_cpfcnpj_con }));
}

async function snapshot(ctx, d, io = {}) {
  const respIndex = io.responsaveisIndex || _respIndex;
  return respIndex(d.id_condominio, d.id_unidade);
}

// "O novo proprietário já consta nesta unidade?" (CPF ou nome) — evita cadastrar a mesma pessoa 2x.
// st_cpf_con é o que responsaveis/index DEVOLVE (a escrita usa ST_CPFCNPJ_CON — a API é assimétrica; ver cadastro_inquilino).
async function checarConflito(ctx, d, io = {}) {
  const atuais = await snapshot(ctx, d, io);
  const cpf = soDigitos(d.cpf);
  const candidatos = atuais.filter((c) => {
    const cpfC = soDigitos(c.st_cpf_con || c.st_cpfcnpj_con);
    return (!!cpf && !!cpfC && cpfC === cpf) || norm(c.st_nome_con) === norm(d.nome);
  });
  return { conflito: candidatos.length > 0, detalhe: candidatos.length ? 'o novo proprietário já consta na unidade' : '', candidatos };
}

async function gravar(payload, { dados, io = {} } = {}) {
  const put = io.slPut || _slPut;
  // 1ª escrita: cadastra o novo proprietário. Falhou aqui → aborta (não dá saída em ninguém).
  const rNovo = await put('unidades/post', payload.novo, 'PUT', 'titularidade'); // actionId → gate WRITE_REAL_ACTIONS
  if (!rNovo.ok) return { ok: false, etapa: 'novo_proprietario', resposta: rNovo.resposta, status: rNovo.status };
  // 2ª+: dá saída em cada proprietário atual. A API do Superlógica NÃO tem transação → se uma saída
  // falhar DEPOIS do novo entrar, retorna ok:true mas marca saidasFalhas>0 (o aprovador/auditoria veem;
  // a Onda C trata no teste controlado). Fingir atomicidade seria pior que reportar o estado parcial.
  const saidas = [];
  for (const s of payload.saidas) {
    const r = await put('unidades/post', s, 'PUT', 'titularidade'); // actionId → gate WRITE_REAL_ACTIONS
    saidas.push({ id_contato_con: s['contatos[0][ID_CONTATO_CON]'], ok: r.ok, dryRun: !!r.dryRun, status: r.status, resposta: r.resposta });
  }
  const saidasFalhas = saidas.filter((s) => !s.ok).length;
  return { ok: true, dryRun: !!rNovo.dryRun, resposta: { novo: rNovo.resposta, saidas }, saidasFalhas };
}

// ── Card do aprovador ─────────────────────────────────────────────────────────────────────────────
const unidadeVisivel = (d) => d.unidade_label || d.id_unidade; // id_unidade é chave de banco; o rótulo vem do ERP
const dataBR = (s) => { const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[2]}/${m[1]}/${m[3]}` : (s || '—'); };

function resumir(d) {
  const saem = (d.proprietarios_atuais || []).map((p) => p.nome).filter(Boolean).join(', ') || '(a confirmar)';
  return `Troca de titularidade da unidade ${unidadeVisivel(d)}: ${d.nome} entra como proprietário em ${dataBR(d.data_transferencia)}; sai ${saem}. O boleto da taxa passa a ir para o novo proprietário.`;
}

function render(d, snap) {
  const atuais = d.proprietarios_atuais || [];
  return {
    resumo: resumir(d),
    campos: [
      { label: 'Condomínio', valor: d.condominio_nome || d.id_condominio },
      { label: 'Unidade', valor: unidadeVisivel(d) },
      { label: 'Novo proprietário', valor: d.nome },
      { label: 'CPF (novo)', valor: d.cpf || '—' },
      { label: 'E-mail', valor: d.email || '—' },
      { label: 'Telefone', valor: d.telefone || '—' },
      { label: 'Data da transferência', valor: dataBR(d.data_transferencia) },
      // item (c): o MATCH do proprietário atual × Superlógica — o que o Fernando pediu. Vem do ERP (tool), CPF mascarado.
      { label: 'Proprietário(s) atual(is) — sai(em)', valor: atuais.map((p) => `${p.nome || '(sem nome)'}${cpf2(p.cpf) ? ' (CPF ' + cpf2(p.cpf) + ')' : ''}`).join(' · ') || '(não identificado)' },
    ],
    diff: [
      { tipo: 'add', texto: `+ novo proprietário "${d.nome}" na unidade ${unidadeVisivel(d)}` },
      ...atuais.map((p) => ({ tipo: 'del', texto: `– saída (inativa) de "${p.nome || p.id_contato_con}" em ${dataBR(d.data_transferencia)}` })),
    ],
    // alertas — peso jurídico (muda o dono): o aprovador CONFERE quem sai antes de assinar.
    alertas: [
      'Confira que o(s) proprietário(s) atual(is) acima é(são) mesmo quem está saindo — a troca dá DATA DE SAÍDA neles (ficam inativos no histórico, não são apagados).',
      ...(atuais.length > 1 ? [`São ${atuais.length} proprietários atuais e TODOS recebem data de saída. Se apenas um sai (ex.: divórcio, herança), avise antes de aprovar.`] : []),
      ...(!d.email ? ['Sem e-mail do novo proprietário: é para onde o boleto é enviado — peça antes de aprovar.'] : []),
    ],
    snapshotResumo: `${(snap || []).length} contato(s) hoje na unidade`,
  };
}

Object.assign(titularidade, { checarConflito, snapshot, gravar, render });
