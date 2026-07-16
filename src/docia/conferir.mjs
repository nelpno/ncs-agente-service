// conferir.mjs — o checklist do DocIA. Aqui mora o JULGAMENTO, e ele é CÓDIGO.
//
// Divisão de trabalho (o que torna o laudo auditável):
//   · o LLM PERCEBE (transcreve o papel, diz o que vê) — extrair.mjs
//   · este módulo JULGA (compara, calcula data, valida dígito) — determinístico e testável
// Um `if` erra igual todo dia e pode ser provado por teste; um prompt erra diferente a cada chamada.
//
// Regras do cliente: "Analise da IA - segurança e procedimentos" (Drive, 13/07) — o checklist é DADO
// (CHECKLIST abaixo), as regras são funções. Anti-escopo (§7 da arquitetura): NADA aqui olha valor de
// aluguel, multa, forma de pagamento ou legalidade — só "a papelada identifica unidade, ocupantes e
// responsável perante o condomínio?".
//
// ASSIMETRIA DELIBERADA: falso-PENDENTE é barato (o humano confere e aprova em 30s); falso-APROVADO é
// dano jurídico ao condomínio. Toda regra abaixo pende na dúvida. Ausência de dado NUNCA vira `ok`
// por omissão — vira `nao_verificavel` e aparece na tela (mesmo princípio do "0 boletos ≠ está em dia").

// Exportado porque o card do Portal CONTA as conferências por status: hardcodar 'ok' lá faria um
// rename aqui zerar a contagem em silêncio ("0 conferências OK" num laudo inteiro verde).
export const STATUS = { OK: 'ok', PENDENTE: 'pendente', DIVERGENTE: 'divergente', NAO_VERIF: 'nao_verificavel' };

export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD')
  .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '').replace(/\s+/g, ' ').trim();

const soDigitos = (s) => String(s ?? '').replace(/\D/g, '');

/** Dígito verificador do CPF. Pega tanto erro de OCR quanto CPF inventado — e é de graça.
 *  Aceita qualquer pontuação: o contrato real veio com "414.990.298/45" (barra no lugar do hífen). */
export function validarCPF(cpf) {
  const d = soDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (base, pesoIni) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoIni - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(d.slice(0, 9), 10) === Number(d[9]) && dv(d.slice(0, 10), 11) === Number(d[10]);
}

/** Idade completa em anos na data de referência (sem lib; off-by-one do aniversário é teste). */
export function idadeEm(nascimento, hoje) {
  const n = new Date(`${nascimento}T00:00:00Z`);
  if (Number.isNaN(n.getTime())) return null;
  const ref = new Date(`${new Date(hoje).toISOString().slice(0, 10)}T00:00:00Z`);
  let anos = ref.getUTCFullYear() - n.getUTCFullYear();
  const m = ref.getUTCMonth() - n.getUTCMonth();
  if (m < 0 || (m === 0 && ref.getUTCDate() < n.getUTCDate())) anos--;
  return anos;
}

const val = (c) => (c && c.valor != null && String(c.valor).trim() !== '' ? String(c.valor).trim() : null);
const ev = (...partes) => partes.filter((p) => p != null && String(p).trim() !== '').join(' · ') || '—';
const acharAss = (e, rotulo) => (e.assinaturas || []).find((a) => norm(a.rotulo) === rotulo && a.presente !== false);

// ---------------------------------------------------------------------------
// CHECKS — cada um devolve { status, evidencia }. `peso` alimenta a confiança;
// `reprova` marca o que não se conserta mandando outro papel (§ parecer).
// ---------------------------------------------------------------------------
const CHECKS = {
  legibilidade: {
    peso: 2,
    fn: (e) => {
      const pgs = e.paginas || [];
      if (!pgs.length) return { status: STATUS.PENDENTE, evidencia: 'nenhuma página legível recebida' };
      const ruins = pgs.filter((p) => p.legibilidade === 'ilegivel');
      const parciais = pgs.filter((p) => p.legibilidade === 'parcial');
      if (ruins.length) return { status: STATUS.PENDENTE, evidencia: `página(s) ${ruins.map((p) => p.n).join(', ')} ilegível(is) — pedir novo arquivo` };
      if (parciais.length) return { status: STATUS.PENDENTE, evidencia: `página(s) ${parciais.map((p) => p.n).join(', ')} parcialmente legível(is)` };
      return { status: STATUS.OK, evidencia: `${pgs.length} página(s) legível(is)` };
    },
  },

  identificacao_imovel: {
    peso: 3,
    fn: (e) => {
      const u = val(e.campos?.unidade), c = val(e.campos?.condominio);
      if (!u && !c) return { status: STATUS.PENDENTE, evidencia: 'contrato não identifica a unidade nem o condomínio' };
      if (!u) return { status: STATUS.PENDENTE, evidencia: 'contrato não identifica o número da unidade' };
      if (!c) return { status: STATUS.PENDENTE, evidencia: 'contrato não identifica o condomínio' };
      const b = val(e.campos?.bloco);
      return { status: STATUS.OK, evidencia: ev(`unidade ${u}${b ? `, bloco ${b}` : ''} — ${c}`, e.campos?.unidade?.evidencia) };
    },
  },

  unidade_existe_no_erp: {
    peso: 2,
    fn: (e, ctx) => {
      if (!ctx.erp) return { status: STATUS.NAO_VERIF, evidencia: 'Superlógica indisponível na hora da análise — conferir a unidade à mão' };
      if (ctx.erp.unidade_existe === false) return { status: STATUS.DIVERGENTE, evidencia: 'unidade do contrato não localizada no cadastro do condomínio' };
      return { status: STATUS.OK, evidencia: `unidade localizada no cadastro: ${ctx.erp.unidade_label || '—'}` };
    },
  },

  // "Nome diferente da matrícula" na prática: o cadastro do ERP veio da matrícula.
  proprietario_bate_com_erp: {
    peso: 3,
    fn: (e, ctx) => {
      const loc = e.campos?.locador?.nome;
      if (!ctx.erp) return { status: STATUS.NAO_VERIF, evidencia: 'Superlógica indisponível — conferir o proprietário à mão' };
      const dono = ctx.erp.proprietario_nome;
      if (!loc || !dono) return { status: STATUS.NAO_VERIF, evidencia: 'sem nome do locador no contrato ou sem proprietário no cadastro para comparar' };
      if (norm(loc) !== norm(dono)) {
        return { status: STATUS.DIVERGENTE, evidencia: `contrato: ${loc} · Superlógica: ${dono}` };
      }
      return { status: STATUS.OK, evidencia: `locador confere com o proprietário cadastrado (${dono})` };
    },
  },

  cpf_partes: {
    peso: 3,
    fn: (e) => {
      const partes = [['locador', e.campos?.locador], ['locatário', e.campos?.locatario]];
      const faltando = partes.filter(([, p]) => !p?.cpf).map(([r]) => r);
      const invalidos = partes.filter(([, p]) => p?.cpf && !validarCPF(p.cpf)).map(([r, p]) => `${r} (${p.cpf})`);
      if (invalidos.length) return { status: STATUS.DIVERGENTE, evidencia: `CPF não confere com o dígito verificador: ${invalidos.join(', ')} — pode ser erro de leitura ou CPF errado no contrato` };
      if (faltando.length) return { status: STATUS.PENDENTE, evidencia: `contrato não traz o CPF de: ${faltando.join(', ')}` };
      return { status: STATUS.OK, evidencia: 'CPF do locador e do locatário presentes e válidos' };
    },
  },

  cpf_bate_com_informado: {
    peso: 2,
    fn: (e, ctx) => {
      const informado = ctx.informado?.cpf;
      const doContrato = e.campos?.locatario?.cpf;
      if (!informado || !doContrato) return { status: STATUS.NAO_VERIF, evidencia: 'sem CPF informado na conversa para comparar' };
      if (soDigitos(informado) !== soDigitos(doContrato)) {
        return { status: STATUS.DIVERGENTE, evidencia: `contrato: ${doContrato} · informado no atendimento: ${informado}` };
      }
      return { status: STATUS.OK, evidencia: 'CPF do contrato confere com o informado no atendimento' };
    },
  },

  // Caso REAL: contrato de uma menina de 14 anos passou pela conferência humana.
  // Menor não tem capacidade civil para locar sozinho → não se conserta com outro papel: REPROVA.
  // Sem data de nascimento não dá para saber — e aí o laudo DIZ que não deu, em vez de calar.
  maioridade_locatario: {
    peso: 3,
    reprova: true,
    fn: (e, ctx) => {
      const nasc = e.campos?.locatario?.data_nascimento;
      if (!nasc) return { status: STATUS.NAO_VERIF, evidencia: 'contrato não traz a data de nascimento do locatário — idade não conferida' };
      const anos = idadeEm(nasc, ctx.hoje);
      if (anos == null) return { status: STATUS.NAO_VERIF, evidencia: `data de nascimento ilegível (${nasc})` };
      if (anos < 18) return { status: STATUS.DIVERGENTE, evidencia: `locatário tem ${anos} anos — menor de idade não pode figurar como locatário sozinho` };
      return { status: STATUS.OK, evidencia: `locatário maior de idade (${anos} anos)` };
    },
  },

  assinatura_locador: {
    peso: 3,
    fn: (e) => {
      const a = acharAss(e, 'locador');
      if (!a) return { status: STATUS.PENDENTE, evidencia: 'não localizada a assinatura do locador — sem assinatura não se cadastra' };
      return { status: STATUS.OK, evidencia: ev(a.evidencia, a.pagina ? `pág. ${a.pagina}` : null) };
    },
  },

  assinatura_locatario: {
    peso: 3,
    fn: (e) => {
      const a = acharAss(e, 'locatario');
      if (!a) return { status: STATUS.PENDENTE, evidencia: 'não localizada a assinatura do locatário — sem assinatura não se cadastra' };
      return { status: STATUS.OK, evidencia: ev(a.evidencia, a.pagina ? `pág. ${a.pagina}` : null) };
    },
  },

  // Caso REAL: o inquilino assinou no campo do proprietário. Só é pegável porque o passo de visão
  // reporta QUAL nome está sob cada assinatura — comparar isso é trabalho de código.
  assinatura_no_campo_certo: {
    peso: 3,
    fn: (e) => {
      const pares = [['locador', e.campos?.locador?.nome], ['locatario', e.campos?.locatario?.nome]];
      const trocadas = [];
      let comparadas = 0;
      for (const [rotulo, nomeParte] of pares) {
        const a = acharAss(e, rotulo);
        if (!a?.nome_sob_assinatura || !nomeParte) continue;
        comparadas++;
        if (norm(a.nome_sob_assinatura) !== norm(nomeParte)) {
          trocadas.push(`campo do ${rotulo}: assinado como "${a.nome_sob_assinatura}", mas a parte declarada é "${nomeParte}"`);
        }
      }
      if (trocadas.length) return { status: STATUS.DIVERGENTE, evidencia: trocadas.join(' · ') };
      if (!comparadas) return { status: STATUS.NAO_VERIF, evidencia: 'não foi possível ler o nome sob as assinaturas' };
      return { status: STATUS.OK, evidencia: 'o nome sob cada assinatura confere com a parte declarada' };
    },
  },

  // "Testemunhas (quando houver)" — o checklist não as exige; o real veio com o campo vazio.
  // Informativo: nunca pende por isso.
  testemunhas: {
    peso: 1,
    fn: (e) => {
      const t = (e.testemunhas || []).filter((x) => x?.presente !== false);
      if (!t.length) return { status: STATUS.NAO_VERIF, evidencia: 'sem testemunhas no documento (o checklist não as exige)' };
      return { status: STATUS.OK, evidencia: `${t.length} testemunha(s)` };
    },
  },

  vigencia_valida: {
    peso: 2,
    fn: (e, ctx) => {
      const v = e.campos?.vigencia;
      if (!v?.fim) return { status: STATUS.PENDENTE, evidencia: 'contrato não traz o prazo/término da locação' };
      const fim = new Date(`${v.fim}T23:59:59Z`);
      if (Number.isNaN(fim.getTime())) return { status: STATUS.NAO_VERIF, evidencia: `término ilegível (${v.fim})` };
      if (fim < new Date(ctx.hoje)) {
        return { status: STATUS.PENDENTE, evidencia: `contrato vencido em ${brDate(v.fim)} — pedir renovação, aditivo ou declaração do proprietário` };
      }
      return { status: STATUS.OK, evidencia: ev(`vigente até ${brDate(v.fim)}`, v.evidencia) };
    },
  },

  paginas_completas: {
    peso: 1,
    fn: (e) => {
      if (e.paginas_completas === false) return { status: STATUS.PENDENTE, evidencia: ev('faltam páginas no documento', e.paginas_completas_evidencia) };
      if (e.paginas_completas === true) return { status: STATUS.OK, evidencia: ev('numeração das páginas completa', e.paginas_completas_evidencia) };
      return { status: STATUS.NAO_VERIF, evidencia: 'documento sem numeração de páginas — não dá para afirmar que veio inteiro' };
    },
  },

  dados_imobiliaria: {
    peso: 2,
    fn: (e) => {
      const i = e.campos?.imobiliaria;
      if (!i?.nome) return { status: STATUS.PENDENTE, evidencia: 'contrato de locação por imobiliária sem identificação da imobiliária' };
      return { status: STATUS.OK, evidencia: ev(i.nome, i.cnpj) };
    },
  },
};

// ---------------------------------------------------------------------------
// CHECKLIST — quais itens valem para cada tipo. É DADO: tipo novo = uma linha aqui.
// (Fase 0 = só os 2 tipos de locação, o grosso do volume de cadastro de inquilino.)
// ---------------------------------------------------------------------------
const COMUNS_LOCACAO = [
  'legibilidade', 'identificacao_imovel', 'unidade_existe_no_erp', 'proprietario_bate_com_erp',
  'cpf_partes', 'cpf_bate_com_informado', 'maioridade_locatario',
  'assinatura_locador', 'assinatura_locatario', 'assinatura_no_campo_certo', 'testemunhas',
  'vigencia_valida', 'paginas_completas',
];
export const CHECKLIST = {
  locacao_particular: COMUNS_LOCACAO,
  locacao_imobiliaria: [...COMUNS_LOCACAO, 'dados_imobiliaria'],
};

const brDate = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '—');
};

// Confiança: fração ponderada de conferências `ok`. Determinística e declarada — não é número
// inventado pelo LLM. `nao_verificavel` vale meio ponto: não é erro, mas também não é garantia.
// Fase 1: INFORMATIVA (nada é roteado por ela). Serve para acumular parecer×decisão humana e só
// então calibrar limiar com dado real. Prometer "98% de confiabilidade" antes de medir seria inventar.
const PONTO = { [STATUS.OK]: 1, [STATUS.NAO_VERIF]: 0.5, [STATUS.PENDENTE]: 0, [STATUS.DIVERGENTE]: 0 };

/**
 * @param {object} extracao  saída de extrair.mjs (campos com evidência + fatos visuais)
 * @param {object} ctx       { hoje, erp:{unidade_existe,unidade_label,proprietario_nome}|null, informado:{cpf} }
 * @returns {{conferencias:Array, divergencias:string[], pendencias:string[], parecer:string, confianca:number}}
 */
export function conferir(extracao, ctx = {}) {
  const e = extracao || {};
  const contexto = { hoje: ctx.hoje || new Date(), erp: ctx.erp ?? null, informado: ctx.informado || {} };
  const itens = CHECKLIST[e.tipo_documento] || CHECKLIST.locacao_particular;

  const conferencias = itens.map((item) => {
    const def = CHECKS[item];
    let r;
    try {
      r = def.fn(e, contexto);
    } catch (err) {
      // Um check que explode NUNCA pode virar "ok" por acidente.
      r = { status: STATUS.NAO_VERIF, evidencia: `não foi possível conferir (${err.message})` };
    }
    return { item, status: r.status, evidencia: String(r.evidencia ?? '—') };
  });

  const divergencias = conferencias.filter((c) => c.status === STATUS.DIVERGENTE).map((c) => c.evidencia);
  const pendencias = conferencias.filter((c) => c.status === STATUS.PENDENTE).map((c) => c.evidencia);

  // REPROVADO ≠ PENDENTE (a distinção é do cliente): PENDENTE = "falta papel, traga e a gente aprova";
  // REPROVADO = "não dá para validar a legitimidade" — mandar outro documento não conserta.
  const reprovou = conferencias.some((c) => c.status === STATUS.DIVERGENTE && CHECKS[c.item]?.reprova);
  const parecer = reprovou ? 'reprovado' : (divergencias.length || pendencias.length) ? 'pendente' : 'aprovado';

  let pesoTot = 0, pontos = 0;
  for (const c of conferencias) {
    const peso = CHECKS[c.item]?.peso ?? 1;
    pesoTot += peso;
    pontos += peso * (PONTO[c.status] ?? 0);
  }
  const confianca = pesoTot ? Math.round((pontos / pesoTot) * 100) / 100 : 0;

  return { conferencias, divergencias, pendencias, parecer, confianca };
}
