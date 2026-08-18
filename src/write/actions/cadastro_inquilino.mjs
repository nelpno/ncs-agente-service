// cadastro_inquilino.mjs — WriteAction #1. Cadastra inquilino/residente ou dependente numa unidade.
import { registerAction } from '../registry.mjs';
import { responsaveisIndex as _respIndex } from '../../superlogica.mjs';
import { slPut as _slPut } from '../../superlogica_write.mjs';
import { enfileirarAvisos } from '../../outbox.mjs';
import { STATUS, validarCPF } from '../../docia/conferir.mjs';
import { validarExtras, payloadExtras } from '../campos_condo.mjs';
// MESMO matcher de nome que o resto do sistema usa (catálogo + resolver do ERP). Aqui serve para
// dizer se quem PEDIU o cadastro é alguém que já mora na unidade: "Ricardo Camargo" tem de casar
// com "Ricardo Prado Camargo", senão o card acusa de intruso quem é o inquilino da casa.
import { tokensNome, casaPorTokens } from '../../../gerador/src/match-nome.mjs';

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
// ⚠️ email/telefone SÃO obrigatórios p/ inquilino (ver validar) — ficam aqui porque a MONTAGEM do payload
// é a mesma (só entram se presentes; quando obrigatórios, sempre presentes). ST_RG_CON é PALPITE (RG não
// confirmado na doc da escrita) — opcional, só entra se a pessoa informar; zero risco quando ausente.
const MAP_OPCIONAIS = {
  email: 'contatos[0][ST_EMAIL_CON]',
  telefone: 'contatos[0][ST_TELEFONE_CON]',
  cpf: 'contatos[0][ST_CPFCNPJ_CON]',
  rg: 'contatos[0][ST_RG_CON]',
};

// ── Formato do e-mail (defeito 6 do teste dos 20) ─────────────────────────────────────────────────
// Ela aceitou `eduardo.simoes@com.br`. O CPF tinha validação, o e-mail não tinha nenhuma — e os dois
// têm a MESMA consequência: é para onde o boleto vai. E-mail errado não devolve erro; o morador só
// não recebe cobrança, "e ninguém descobre até virar inadimplência" (Fernando, 07/08).
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
// Domínios que são SÓ sufixo público: `@com.br` passa em qualquer regex estrutural (com.br é um
// domínio bem formado) e mesmo assim não existe caixa de e-mail nele. Só uma lista pega este caso —
// que é justamente o que a Ana aceitou.
const SUFIXO_PUBLICO_NU = new Set(['com', 'br', 'com.br', 'net', 'net.br', 'org', 'org.br',
  'gov.br', 'edu.br', 'adv.br', 'eng.br', 'co', 'co.uk', 'info', 'biz']);
export function emailValido(valor) {
  const s = String(valor || '').trim();
  if (!EMAIL_RE.test(s)) return false;
  return !SUFIXO_PUBLICO_NU.has(s.split('@')[1].toLowerCase());
}

// ⚠️ 14 dígitos = CNPJ e passa direto: pessoa jurídica PODE ser inquilina, e barrar isso seria um
// defeito novo em cima do que estamos consertando. Não há validador de CNPJ aqui, então o número é
// aceito sem conferência de dígito — limitação conhecida e preferível a bloquear um caso legítimo.
export function cpfCnpjValido(valor) {
  const d = String(valor || '').replace(/\D/g, '');
  if (d.length === 14) return true;
  return validarCPF(d);
}

function validar(d) {
  const erros = [];
  for (const k of ['id_condominio', 'id_unidade', 'nome', 'data_entrada']) if (!d?.[k]) erros.push(`faltou ${k}`);
  // CPF do inquilino — Fernando, 15/07: "o CPF, para gerar o boleto da taxa de condomínio... sem o
  // CPF a gente não consegue gerar". Sem ele o cadastro ENTRA e não serve para nada: a equipe não
  // emite o boleto e o caso volta. Travar aqui faz a Ana pedir, em vez de mandar para a fila um
  // rascunho natimorto. Dependente não recebe cobrança (141/141 no dado real) → não precisa.
  if (d?.papel !== 'dependente' && !d?.cpf) erros.push('faltou cpf (sem ele a equipe não gera o boleto da taxa)');
  // ⚠️ e-mail e telefone: OBRIGATÓRIOS para inquilino. O Fernando REVERTEU em 22/07 a graduação de
  // 14/07 ("o telefone não era muito necessário") — a decisão VIGENTE é "e-mail e telefone celular
  // OBRIGATÓRIOS" no cadastro de inquilino/titularidade. A Ana COLETA na conversa (o card chega
  // completo e o "Devolver" vira raro); sem eles ela PEDE, não manda um rascunho pela metade.
  // ⚠️ NÃO reverter para alerta: a trilha desta decisão custou uma sessão em 14/07 (a próxima sessão
  // "consertou" de volta). DEPENDENTE segue LENIENTE (Fernando: "menor de idade não é obrigatório RG,
  // CPF nem telefone") → nada além de nome/unidade/condomínio/data.
  if (d?.papel !== 'dependente') {
    if (!d?.email) erros.push('faltou e-mail (é para onde o boleto é enviado — obrigatório)');
    if (!d?.telefone) erros.push('faltou telefone (contato que entra no sistema da portaria — obrigatório)');
    // Extras por condomínio (Tivoli 164: data de nascimento + veículo + placa). Vazio p/ condo comum
    // (byte-idêntico). Só para não-dependente: "qualquer tipo ADULTO" (Fernando) — nunca trava um
    // dependente menor por falta de placa/nascimento, o que contraria a leniência acima.
    erros.push(...validarExtras(d?.id_condominio, d));
  }
  // Dado ERRADO é erro em qualquer papel — a leniência do dependente é sobre o dado AUSENTE
  // ("menor não é obrigatório RG, CPF nem telefone"), nunca sobre guardar um número que não existe.
  if (d?.cpf && !cpfCnpjValido(d.cpf)) erros.push('cpf inválido (o dígito verificador não confere) — confirme o número com a pessoa');
  if (d?.email && !emailValido(d.email)) erros.push('e-mail inválido (o endereço não existe nesse formato) — confirme com a pessoa; é para onde o boleto é enviado');
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
    // ⚠️ O corpo do unidades/post usa ID_CONDOMINIO_COND / ID_UNIDADE_UNI (doc pg 26), NÃO o
    // idCondominio/idUnidade dos GETs. Com os nomes errados a API responde HTTP 206 {status:500,
    // "Número da unidade não informada"} e NÃO grava — provado no teste controlado (Fase 0, 23/07).
    ID_CONDOMINIO_COND: String(d.id_condominio),
    ID_UNIDADE_UNI: String(d.id_unidade),
    'contatos[0][ST_NOME_CON]': d.nome,
    'contatos[0][DT_ENTRADA_RES]': d.data_entrada,
    'contatos[0][ID_LABEL_TRES]': d.papel === 'dependente' ? '4' : '7',
    'contatos[0][ID_TIPORESP_TRES]': inquilinoRecebe(d) ? TIPORESP_INQUILINO_RESPONSAVEL : TIPORESP_NAO_RECEBE,
    'contatos[0][ID_TIPOCONTATO_TCON]': '1', // condômino
  };
  // .trim(): o e-mail chega da conversa e vem com espaço em volta com frequência. Gravar " x@y.com "
  // no campo de cobrança é o mesmo que gravar errado.
  for (const [campo, chave] of Object.entries(MAP_OPCIONAIS)) if (d[campo]) p[chave] = typeof d[campo] === 'string' ? d[campo].trim() : d[campo];
  // Extras por condomínio que VÃO ao ERP (Tivoli: DT_NASCIMENTO_CON). Veículo/placa têm payload:null →
  // não entram aqui (ficam no card + aviso à portaria). Vazio p/ condo comum (byte-idêntico).
  Object.assign(p, payloadExtras(d.id_condominio, d));
  return p;
}

// "Pode ligar (mas só efetivar se tiver contrato) / Sem contrato - não efetiva" — Fernando, 17/08/2026,
// ao autorizar a gravação real. Até então o card só AVISAVA (ver o comentário do alerta mais abaixo:
// "não bloqueia o botão nem decide nada"), então ligar WRITE_REAL_ACTIONS sem isto entregaria o
// oposto do combinado.
//
// Mora AQUI e não em `validar()` de propósito: `validar` roda também na CRIAÇÃO do rascunho
// (engine.mjs:54), e travar ali faria o card não nascer — a equipe nem saberia que a pessoa pediu,
// que é pior que o problema que se quer resolver. O card continua nascendo; o que não acontece é a
// gravação no ERP.
//
// Três fronteiras, cada uma com teste:
//  - DEPENDENTE nunca trava: não existe contrato de locação de filho/cônjuge de quem já mora lá.
//  - DocIA DESLIGADO nunca trava: sem ele não há como saber do contrato, e travar todo cadastro por
//    uma peça nossa estar fora seria falhar fechado no lugar errado.
//  - Documento que CHEGOU mas não foi conferido PASSA. É a conversa 848: o contrato foi enviado, a
//    conferência não rodou, e a equipe está com o documento na tela. Travar ali prenderia um cadastro
//    certo. O card já distingue esse caso desde 10/08 e continua avisando.
function bloqueiaGravacao(d = {}) {
  if (d.papel === 'dependente') return null;
  if (!d.docia_ativo) return null;
  if (d.laudo || d.documento_recebido) return null;
  return {
    bloqueia: true,
    motivo: 'sem_contrato',
    mensagem: 'Sem contrato de locação não é possível concluir este cadastro. '
      + 'Peça o contrato ao solicitante e confira antes de aprovar.',
  };
}

export const cadastroInquilino = {
  id: 'cadastro_inquilino',
  descricao: 'Cadastrar inquilino/residente ou dependente numa unidade',
  titulo: 'Cadastro de inquilino', // cabeçalho na tela do aprovador (o `id` é enum de banco, não texto)
  timeAprovador: 'Recepção',
  validar,
  montarPayload,
  bloqueiaGravacao,
};
registerAction(cadastroInquilino);

// ⚠️ O `\s+ → ' '` não é zelo: o ERP guarda "DANIEL  PAGANIN" com DOIS espaços, e ninguém digita
// assim. Sem colapsar, a comparação de nome do `checarConflito` falha calada e a duplicata passa —
// medido no stress de 08/08 (cenário S13) e provado no container com controle positivo: o mesmo nome
// copiado byte a byte do ERP acusava, o nome digitado não. 10 de 1.187 contatos numa amostra de 5
// condomínios têm espaço duplo. Colapsar é normalização da MESMA string; NÃO abre para nome parcial
// ("Muller de Souza" continua não casando "Bruno Muller de Souza"), que é decisão de 16/07 e tem
// teste próprio.
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '').replace(/\s+/g, ' ').trim();

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
  const res = await put('unidades/post', payload, 'PUT', 'cadastro_inquilino'); // actionId → gate WRITE_REAL_ACTIONS (fica DRY até estar no allowlist)
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

// ── Quem já mora na unidade ───────────────────────────────────────────────────────────────────────
// O card não mostrava NINGUÉM: no caso 12 do teste dos 20 a unidade tinha 3 moradores e o aprovador
// decidia no escuro. É também o que substitui a conferência que a Ana tentava fazer sozinha — ela só
// enxerga o contato que o resolver_cadastro devolveu (o proprietário), e por isso acusou de intruso
// um inquilino de 2 anos. Aqui vê-se a unidade inteira, e quem julga é a pessoa.
//
// O papel sai de `id_label_tres` por mapa EXPLÍCITO: os valores estão documentados no topo deste
// arquivo e são os mesmos que a escrita usa. `st_nometiporesp_tres` não entra — o nome do campo é
// ambíguo entre "papel" e "quem recebe a cobrança", e rótulo errado no card é mentira silenciosa.
const PAPEL_LABEL = { 1: 'proprietário', 2: 'proprietário', 3: 'imobiliária', 4: 'dependente', 7: 'inquilino', 999: 'procurador' };
const ORDEM_PAPEL = ['proprietário', 'inquilino', 'dependente', 'imobiliária', 'procurador', 'contato'];
const MAX_CONTATOS = 8;
const ativo = (c) => !String(c?.dt_saida_res || '').trim(); // quem saiu não é morador de hoje
const papelDoContato = (c) => PAPEL_LABEL[Number(c?.id_label_tres)] || 'contato';

export function contatosDaUnidade(snap) {
  return (Array.isArray(snap) ? snap : []).filter(ativo)
    .map((c) => ({ nome: String(c.st_nome_con || '').trim(), papel: papelDoContato(c) }))
    .filter((c) => c.nome)
    .sort((a, b) => ORDEM_PAPEL.indexOf(a.papel) - ORDEM_PAPEL.indexOf(b.papel));
}

function textoContatos(lista) {
  if (!lista.length) return 'ninguém cadastrado hoje nesta unidade';
  const mostra = lista.slice(0, MAX_CONTATOS).map((c) => `${c.nome} (${c.papel})`).join(' · ');
  // Corte declarado: "são 8" quando são 12 faria o aprovador conferir contra uma lista incompleta.
  return lista.length > MAX_CONTATOS ? `${mostra} · +${lista.length - MAX_CONTATOS} outro(s)` : mostra;
}

/** Quem pediu já mora na unidade? Nome parcial casa ("Ricardo Camargo" ⊂ "Ricardo Prado Camargo"). */
export function solicitanteEhDaUnidade(solicitante, lista) {
  const toks = tokensNome(solicitante || '');
  if (!toks.length) return false;
  return lista.some((c) => casaPorTokens(toks, [c.nome]));
}

function render(d, snap, opts = {}) {
  const recebe = inquilinoRecebe(d);
  const doc = linhasDocia(d.laudo);
  const ehDependente = d.papel === 'dependente';
  const contatos = contatosDaUnidade(snap);
  // A leitura de contrato pode estar desligada (DOCIA_ATIVO). Cobrar um documento que o sistema nem
  // consegue receber seria alarme em 100% dos cards de inquilino — o ruído que este trabalho remove.
  // ⚠️ A fonte é o RASCUNHO (`d.docia_ativo`, gravado na criação), não o ambiente: o card é desenhado
  // tanto pelo ncs-agente quanto pelo ncs-chat, e só o primeiro tem a variável. Pelo ambiente, o
  // alerta apareceria no painel por link e sumiria no Portal, que é onde a equipe aprova.
  const dociaAtivo = opts.dociaAtivo ?? d.docia_ativo ?? (process.env.DOCIA_ATIVO === '1');
  const pediuAlguemDeFora = ehDependente && d.solicitante_nome && !solicitanteEhDaUnidade(d.solicitante_nome, contatos);
  const alertas = [
    // 1º o que é ESCRITA no ERP: o flip do proprietário (1 → 2 "só extras") é uma 2ª gravação, num
    // contato que já existe, e não sai daqui. Sem ele, proprietário e inquilino recebem a MESMA taxa.
    ...(recebe ? [`Ao aprovar, mude o proprietário da unidade ${unidadeVisivel(d)} para "só cobranças extras" no Superlógica — sem isso o boleto da taxa sai para o proprietário E para o inquilino (duplicado).`] : []),
    // 2º segurança de acesso. Fernando, 07/08: "tem que ser pelo titular do imóvel que tá vinculado à
    // unidade" — veio da vez em que um rapaz pediu o próprio cadastro como dependente e a equipe só
    // liberou depois que a tia falou. A Ana registra e o card confere; ela não bloqueia ninguém,
    // porque não tem como verificar identidade pelo WhatsApp.
    ...(pediuAlguemDeFora ? [`Quem pediu ("${d.solicitante_nome}") não consta como morador desta unidade. Cadastro de dependente deve ser pedido pelo titular (proprietário ou inquilino) — confirme com ele antes de liberar o acesso.`] : []),
    ...(ehDependente && !d.solicitante_nome ? ['Não ficou registrado quem pediu este cadastro — confirme com o titular da unidade antes de liberar o acesso.'] : []),
    // 3º o documento. Fernando: "Ela teria que ter mandado o contrato" / "sempre que é locação tem
    // contrato, particular ou da imobiliária — senão não tem como fazer". Só para inquilino:
    // dependente não precisa de contrato (ele disse isso na mesma frase).
    // ⚠️ O alerta media a ausência de LAUDO e afirmava a ausência de CONTRATO — não é a mesma coisa.
    // 10/08 (conv 848): o cliente mandou o contrato às 13:14, a Ana LEU o documento e criou o cadastro
    // às 13:18 sem nunca chamar a conferência (ela perguntou "é só essa página?" e ele respondeu outra
    // coisa). O card estampou "não veio contrato", a equipe leu como fato e passou a tarde pedindo ao
    // cliente um documento que ele já havia enviado. `documento_recebido` é gravado na criação do
    // rascunho (o dossiê tinha páginas) e separa os dois casos. Segue sendo alerta, não trava.
    ...(!ehDependente && dociaAtivo && !d.laudo
      ? [d.documento_recebido
        ? 'O contrato chegou nesta conversa mas NÃO passou pela conferência automática — abra o documento e confira antes de aprovar.'
        : 'Não veio contrato de locação nesta conversa — peça e confira antes de aprovar.']
      : []),
    // 4º dado que falta e a equipe precisa buscar. ⚠️ Só para quem RECEBE boleto: para dependente,
    // "sem e-mail: é para onde o boleto é enviado" contradizia o próprio card duas linhas acima
    // ("o boleto continua indo para o proprietário") — e alarme falso repetido ensina a equipe a
    // ignorar o alerta que importa. O CPF não aparece aqui porque nem chega: `validar` barra antes.
    ...(!ehDependente && !d.email ? ['Sem e-mail: é para onde o boleto é enviado — peça antes de aprovar.'] : []),
    ...(!ehDependente && !d.telefone ? ['Sem telefone: é o contato que entra no sistema da portaria.'] : []),
    ...doc.alertas,
  ];
  return {
    resumo: resumir(d) + doc.selo,
    // Selo VERDE, pedido do Fernando (07/08): "nenhum tá verdinho... podia ter um verdinho, a pessoa:
    // checklist já pegou tudo". Só existe quando NÃO há nenhum alerta — um verde ao lado de uma
    // pendência valeria menos que nenhum verde. É ele que devolve significado ao vermelho.
    ...(alertas.length === 0 ? { selo: { tipo: 'ok', texto: 'Conferido: nada pendente neste cadastro.' } } : {}),
    campos: [
      { label: 'Condomínio', valor: d.condominio_nome || d.id_condominio },
      { label: 'Unidade', valor: unidadeVisivel(d) },
      { label: 'Nome', valor: d.nome },
      { label: 'Papel', valor: ehDependente ? 'Dependente' : 'Inquilino/Residente' },
      { label: 'Entrada', valor: dataBR(d.data_entrada) },
      { label: 'E-mail', valor: d.email || '—' },
      { label: 'Telefone', valor: d.telefone || '—' },
      { label: 'CPF', valor: d.cpf || '—' },
      // Extras coletados (condomínios com exigência própria, ex. Tivoli): só aparecem quando presentes,
      // então o card dos condos comuns fica idêntico. A placa vive aqui p/ o aprovador (o aviso à
      // portaria com placa é passo futuro no outbox — hoje o ator do aviso não carrega veículo).
      ...(d.data_nascimento ? [{ label: 'Data de nascimento', valor: dataBR(d.data_nascimento) }] : []),
      ...(d.rg ? [{ label: 'RG', valor: d.rg }] : []),
      ...(d.veiculo_modelo || d.veiculo_placa ? [{ label: 'Veículo', valor: [d.veiculo_modelo, d.veiculo_placa].filter(Boolean).join(' · ') }] : []),
      { label: 'Quem recebe o boleto', valor: recebe ? 'O inquilino (responsável pela cobrança)' : 'O proprietário (padrão)' },
      // Quem PEDIU, como a pessoa se identificou na conversa. Fica ao lado da lista de moradores:
      // é a conferência do titular, feita por quem tem como fazê-la.
      ...(d.solicitante_nome ? [{ label: 'Quem pediu', valor: d.solicitante_nome }] : []),
      { label: 'Quem já está na unidade', valor: textoContatos(contatos) },
      ...(doc.campo ? [doc.campo] : []),
    ],
    diff: [{ tipo: 'add', texto: `+ novo contato "${d.nome}" na unidade ${unidadeVisivel(d)}` }],
    alertas,
    snapshotResumo: `${contatos.length} contato(s) hoje na unidade`,
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
