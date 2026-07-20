// inadimplentes.mjs — classificador dos 3 baldes da cobrança extrajudicial +30d.
// PURO e testável (sem API/PII): recebe a unidade no shape NORMALIZADO e devolve o balde + motivos.
// A espinha de segurança da §5-bis do raio-x vive aqui: judicial/garantidora/acordo/sem-email NUNCA são
// cobrados; casos sensíveis (valor alto / interação recente / bounce) vão pra REVISAR (humano).
// ⚠️ Este módulo NÃO é a re-checagem-no-envio (must-have nº1) — essa roda de novo, ao vivo, na hora do disparo.
//
// Shape normalizado da unidade (o wrapper extrai da resposta real do inadimplencia/index — ver probe 18/07):
//   { id_unidade, unidade_label, condominio_id, email, cpf, nome,
//     boletos: [{ id_recebimento, dias_atraso, valor_total, valor_corrigido, em_processo, em_acordo }],
//     no_juridico, garantidora:{tipo}|null, ultimo_contato_dias:number|null, bounce_anterior:bool }

const DEFAULTS = { minDias: 30, valorAltoMult: 3, taxaMensal: null, revisarInteracaoDias: 15 };

const _num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const _preenchido = (v) => !!(v != null && String(v).trim() !== '' && String(v).trim() !== '0');

/**
 * extrairContato(resumoRow) → { email, emails, cpf, nome }
 * O e-mail/CPF/nome vêm do RESUMO (inadimplencia/index?apenasResumoInad=1) — no DETALHE não estão no top-level.
 * Nomes de campo REAIS da resposta (não do payload de escrita): st_email_con / st_cpf_con / st_nome_con.
 * ⚠️ st_email_con pode trazer VÁRIOS e-mails separados por ';'/','/espaço (real: uni 16348 condo 191 tem 3) —
 * validar a string inteira dava "sem_email" FALSO (bloqueio calado de um devedor). `emails` = todos os válidos;
 * `email` = o 1º válido (primário). LGPD: mandar p/ TODOS pode expor a dívida a terceiro (imobiliária) — decidir no envio.
 */
export function extrairContato(resumoRow = {}) {
  const emails = String(resumoRow.st_email_con || '')
    .split(/[;,\s]+/).map((e) => e.trim()).filter((e) => emailValido(e));
  return {
    email: emails[0] || null,
    emails,
    cpf: (resumoRow.st_cpf_con || '').trim() || null,
    nome: (resumoRow.st_nome_con || resumoRow.nome_formatado || '').trim() || null,
  };
}

/**
 * normalizarUnidade(detalhe, extras?) → unidade no shape do classificador.
 * `detalhe` = 1 item do inadimplencia/index (variante DETALHE, sem apenasResumoInad). Mapeia recebimento[].encargos.
 * `extras` = { email, cpf, nome, garantidora, ultimo_contato_dias, bounce_anterior } — o wrapper injeta (resumo + garantidora + CRM).
 * Mantido PURO (sem chamada de API) p/ ser testável com fixture do snapshot real.
 */
export function normalizarUnidade(detalhe = {}, extras = {}) {
  const recs = Array.isArray(detalhe.recebimento) ? detalhe.recebimento : [];
  const boletos = recs.map((b) => {
    const enc = Array.isArray(b.encargos) ? b.encargos[0] : b.encargos;
    return {
      id_recebimento: b.id_recebimento_recb,
      dias_atraso: _num(enc?.diasatraso),
      valor_total: _num(b.vl_total_recb),
      valor_corrigido: enc?.valorcorrigido != null ? _num(enc.valorcorrigido) : _num(b.vl_total_recb),
      em_processo: _preenchido(b.id_processo_proc),
      em_acordo: _preenchido(b.id_acordo_recb),
    };
  });
  const label = detalhe.nome_formatado
    || [detalhe.st_bloco_uni, detalhe.st_unidade_uni].filter(Boolean).join(' ').trim()
    || String(detalhe.id_unidade_uni || '');
  return {
    id_unidade: detalhe.id_unidade_uni != null ? String(detalhe.id_unidade_uni) : null,
    unidade_label: label,
    condominio_id: detalhe.id_condominio_cond != null ? _num(detalhe.id_condominio_cond) : null,
    email: extras.email ?? null,
    emails: extras.emails ?? (extras.email ? [extras.email] : []),
    cpf: extras.cpf ?? null,
    nome: extras.nome ?? null,
    boletos,
    no_juridico: Array.isArray(detalhe.processos) && detalhe.processos.length > 0,
    garantidora: extras.garantidora ?? null,
    ultimo_contato_dias: extras.ultimo_contato_dias ?? null,
    bounce_anterior: extras.bounce_anterior ?? false,
  };
}

const emailValido = (e) => typeof e === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim());

// garantidora que impede a NCS de cobrar: 'total' bloqueia; 'allure' é exceção (NCS gera boleto normal).
const garantidoraBloqueia = (g) => !!g && g.tipo && g.tipo !== 'allure';

/**
 * classificarUnidade(u, opts?) → { balde:'pronto'|'revisar'|'bloqueado'|'nenhum', motivos:[], elegivel, valor_corrigido, qtd_boletos }
 * Precedência: BLOQUEADO (garantidora > judicial > já-em-acordo > sem-email) > nada-elegível > REVISAR > PRONTO.
 */
export function classificarUnidade(u = {}, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const boletos = Array.isArray(u.boletos) ? u.boletos : [];
  const motivos = [];

  // elegíveis = vencidos >= minDias, não judicial, não em acordo (são os que a NCS pode cobrar por e-mail)
  const elegiveis = boletos.filter((b) => Number(b.dias_atraso) >= o.minDias && !b.em_processo && !b.em_acordo);
  const valor_corrigido = elegiveis.reduce((s, b) => s + (Number(b.valor_corrigido) || 0), 0);
  const base = { motivos, elegivel: elegiveis.length > 0, valor_corrigido, qtd_boletos: elegiveis.length };

  // --- BLOQUEIOS (não envia; precedência do mais forte pro mais fraco) ---
  if (garantidoraBloqueia(u.garantidora)) motivos.push('garantidora');
  if (u.no_juridico || (boletos.length > 0 && boletos.every((b) => b.em_processo))) motivos.push('judicial');
  if (boletos.length > 0 && boletos.every((b) => b.em_acordo)) motivos.push('ja_em_acordo');
  if (motivos.length) return { ...base, balde: 'bloqueado' };

  // sem débito cobrável +30d → fora da leva (não é bloqueio, é "nada a fazer")
  if (elegiveis.length === 0) return { ...base, balde: 'nenhum' };

  // tem débito elegível mas não dá pra enviar e-mail → bloqueado (vira pendência/relatório, nunca log)
  if (!emailValido(u.email)) { motivos.push('sem_email'); return { ...base, balde: 'bloqueado' }; }

  // --- REVISAR (envia, mas humano confere antes) ---
  if (o.taxaMensal && valor_corrigido > o.valorAltoMult * o.taxaMensal) motivos.push('valor_alto');
  if (u.ultimo_contato_dias != null && Number(u.ultimo_contato_dias) < o.revisarInteracaoDias) motivos.push('interacao_recente');
  if (u.bounce_anterior) motivos.push('bounce');
  if (motivos.length) return { ...base, balde: 'revisar' };

  return { ...base, balde: 'pronto' };
}

/**
 * classificarLeva(unidades, opts?) → { prontos, revisar, bloqueados, ignorados, totais }
 * ignorados = balde 'nenhum' (sem débito +30d). totais = contagens + valor somado de prontos/revisar.
 * Cada item carrega { unidade, ...classificacao } p/ a UI mostrar rótulo + motivos.
 */
export function classificarLeva(unidades = [], opts = {}) {
  const prontos = [], revisar = [], bloqueados = [], ignorados = [];
  for (const u of unidades) {
    const r = classificarUnidade(u, opts);
    const item = { unidade: u, ...r };
    if (r.balde === 'pronto') prontos.push(item);
    else if (r.balde === 'revisar') revisar.push(item);
    else if (r.balde === 'bloqueado') bloqueados.push(item);
    else ignorados.push(item);
  }
  const soma = (arr) => arr.reduce((s, it) => s + (it.valor_corrigido || 0), 0);
  return {
    prontos, revisar, bloqueados, ignorados,
    totais: {
      prontos: prontos.length, revisar: revisar.length, bloqueados: bloqueados.length, ignorados: ignorados.length,
      valor_prontos: soma(prontos), valor_revisar: soma(revisar),
    },
  };
}
