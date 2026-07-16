// test_docia_conferir.mjs — o checklist determinístico do DocIA (puro, sem rede, sem LLM).
// Este é o teste que importa: quem JULGA o contrato é código, não o modelo. O LLM só extrai.
// Fixtures sintéticas (sem PII real) → roda no gate do CI. O contrato real vive em .tmp/ (teste AO VIVO à parte).
import { conferir, validarCPF } from '../src/docia/conferir.mjs';

let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };
const st = (l, item) => l.conferencias.find((c) => c.item === item)?.status;

const HOJE = new Date('2026-07-15T12:00:00Z');

// Base: locação particular saudável, modelada no contrato REAL (Allure 401 bloco 11), com dados fictícios.
const base = () => ({
  tipo_documento: 'locacao_particular',
  paginas: [{ n: 1, legibilidade: 'ok' }, { n: 2, legibilidade: 'ok' }, { n: 3, legibilidade: 'ok' }],
  campos: {
    condominio: { valor: 'Residencial Teste', evidencia: 'Residencial Teste', pagina: 1 },
    unidade: { valor: '401', evidencia: 'apartamento 401, bloco 11', pagina: 1 },
    bloco: { valor: '11', evidencia: 'apartamento 401, bloco 11', pagina: 1 },
    locador: { nome: 'MARIA DE SOUZA', cpf: '111.444.777-35', evidencia: 'LOCADOR: MARIA DE SOUZA', pagina: 1 },
    locatario: { nome: 'JOAO DA SILVA', cpf: '111.444.777-35', data_nascimento: null, evidencia: 'LOCATÁRIO: JOAO DA SILVA', pagina: 1 },
    data_contrato: { valor: '2026-05-19', evidencia: 'Araraquara, 19 de maio de 2026', pagina: 3 },
    vigencia: { inicio: '2026-05-19', fim: '2027-05-19', evidencia: 'início em 19/05/2026 e término previsto para o dia 19/05/2027', pagina: 1 },
  },
  assinaturas: [
    { rotulo: 'locador', nome_sob_assinatura: 'MARIA DE SOUZA', presente: true, pagina: 3, evidencia: 'Assinatura acima de "MARIA DE SOUZA (locador)"' },
    { rotulo: 'locatario', nome_sob_assinatura: 'JOAO DA SILVA', presente: true, pagina: 3, evidencia: 'Assinatura acima de "JOAO DA SILVA (locatário)"' },
  ],
});
const ctx = () => ({
  hoje: HOJE,
  erp: { unidade_existe: true, unidade_label: 'Apto 401 Bloco 11', proprietario_nome: 'MARIA DE SOUZA', condominio_nome: 'Residencial Teste' },
});

// ---------- CPF: dígito verificador (pega erro de OCR E CPF inventado) ----------
ok(validarCPF('111.444.777-35') === true, 'CPF válido reconhecido');
ok(validarCPF('111.444.777-36') === false, 'CPF com dígito errado rejeitado');
ok(validarCPF('111.111.111-11') === false, 'CPF de dígitos repetidos rejeitado');
ok(validarCPF('414.990.298/45') === validarCPF('41499029845'), 'pontuação torta do original não muda o veredito (o real veio com "/")');
ok(validarCPF('123') === false, 'CPF truncado rejeitado');

// ---------- caminho feliz ----------
const feliz = conferir(base(), ctx());
ok(feliz.parecer === 'aprovado', 'contrato saudável → APROVADO');
ok(st(feliz, 'identificacao_imovel') === 'ok', 'imóvel identificado');
ok(st(feliz, 'assinatura_locador') === 'ok', 'assinatura do locador presente');
ok(st(feliz, 'vigencia_valida') === 'ok', 'vigência em dia');
ok(feliz.pendencias.length === 0, 'sem pendências no caminho feliz');
ok(feliz.conferencias.every((c) => typeof c.evidencia === 'string'), 'toda conferência carrega evidência');

// ---------- CASO REAL 1: menina de 14 anos (passou batido na conferência humana) ----------
const menor = base();
menor.campos.locatario.data_nascimento = '2012-03-10'; // 14 anos em 15/07/2026
const rMenor = conferir(menor, ctx());
ok(st(rMenor, 'maioridade_locatario') === 'divergente', 'locatário menor de idade → divergente');
ok(rMenor.parecer === 'reprovado', 'menor de idade REPROVA (incapaz de locar sozinho)');
ok(rMenor.divergencias.some((d) => /menor|idade|14/i.test(d)), 'divergência de idade é dita em português');

const aniversario = base();
aniversario.campos.locatario.data_nascimento = '2008-07-15'; // faz 18 exatamente hoje
ok(st(conferir(aniversario, ctx()), 'maioridade_locatario') === 'ok', 'faz 18 hoje → maior (limite exato)');
const quase = base();
quase.campos.locatario.data_nascimento = '2008-07-16'; // 18 só amanhã
ok(st(conferir(quase, ctx()), 'maioridade_locatario') === 'divergente', 'faz 18 amanhã → ainda menor (off-by-one)');

// sem data de nascimento → NÃO inventa: fica visível como não verificável e não bloqueia (Fase 0)
ok(st(feliz, 'maioridade_locatario') === 'nao_verificavel', 'sem data de nascimento → nao_verificavel, nunca "ok" por omissão');

// ---------- CASO REAL 2: assinatura no campo trocado ----------
const trocada = base();
trocada.assinaturas[0].nome_sob_assinatura = 'JOAO DA SILVA'; // o inquilino assinou no campo do proprietário
const rTroca = conferir(trocada, ctx());
ok(st(rTroca, 'assinatura_no_campo_certo') === 'divergente', 'inquilino assinando no campo do proprietário → divergente');
ok(rTroca.parecer !== 'aprovado', 'assinatura trocada nunca sai como aprovado');

// ---------- assinatura ausente ----------
const semAss = base();
semAss.assinaturas = [semAss.assinaturas[1]];
const rSemAss = conferir(semAss, ctx());
ok(st(rSemAss, 'assinatura_locador') === 'pendente', 'assinatura do locador ausente → pendente');
ok(rSemAss.parecer === 'pendente', 'sem assinatura não cadastra (checklist do cliente)');

// ---------- vigência ----------
const vencido = base();
vencido.campos.vigencia = { inicio: '2024-01-01', fim: '2025-01-01', evidencia: 'término 01/01/2025', pagina: 1 };
const rVenc = conferir(vencido, ctx());
ok(st(rVenc, 'vigencia_valida') === 'pendente', 'contrato vencido → pendente (pedir renovação/aditivo)');
ok(rVenc.pendencias.some((p) => /vencid|renova/i.test(p)), 'pendência de vencido explica o que pedir');

// ---------- cruzamento com o ERP ----------
const outroDono = base();
const ctxOutro = ctx();
ctxOutro.erp.proprietario_nome = 'CARLOS PEREIRA';
const rDono = conferir(outroDono, ctxOutro);
ok(st(rDono, 'proprietario_bate_com_erp') === 'divergente', 'locador ≠ proprietário do ERP → divergente');
ok(rDono.parecer !== 'aprovado', 'divergência de titularidade nunca aprova (é decisão humana)');

const ctxAcento = ctx();
ctxAcento.erp.proprietario_nome = 'maria de souza'; // ERP devolve sem acento/caixa (dado real vem assim)
ok(st(conferir(base(), ctxAcento), 'proprietario_bate_com_erp') === 'ok', 'comparação de nome ignora caixa/acento');

// ERP fora do ar → degrada para nao_verificavel, NUNCA "ok" por omissão ("0 boletos ≠ está em dia")
const ctxSemErp = { hoje: HOJE, erp: null };
const rSemErp = conferir(base(), ctxSemErp);
ok(st(rSemErp, 'proprietario_bate_com_erp') === 'nao_verificavel', 'ERP indisponível → nao_verificavel');
ok(st(rSemErp, 'unidade_existe_no_erp') === 'nao_verificavel', 'ERP indisponível → unidade nao_verificavel');

// ---------- CPF divergente do informado ----------
const ctxCpf = ctx();
ctxCpf.informado = { cpf: '529.982.247-25' };
ok(st(conferir(base(), ctxCpf), 'cpf_bate_com_informado') === 'divergente', 'CPF do contrato ≠ CPF informado → divergente');

// ---------- legibilidade ----------
const ruim = base();
ruim.paginas[1].legibilidade = 'ilegivel';
const rRuim = conferir(ruim, ctx());
ok(st(rRuim, 'legibilidade') === 'pendente', 'página ilegível → pendente (pedir reenvio)');
ok(rRuim.confianca < feliz.confianca, 'ilegibilidade derruba a confiança');

// ---------- tipo imobiliária: exige dados da imobiliária ----------
const imob = base();
imob.tipo_documento = 'locacao_imobiliaria';
ok(st(conferir(imob, ctx()), 'dados_imobiliaria') === 'pendente', 'locação por imobiliária sem dados da imobiliária → pendente');
imob.campos.imobiliaria = { nome: 'Imob Teste', cnpj: '11.222.333/0001-81', evidencia: 'Imob Teste LTDA', pagina: 1 };
ok(st(conferir(imob, ctx()), 'dados_imobiliaria') === 'ok', 'com dados da imobiliária → ok');
ok(conferir(base(), ctx()).conferencias.every((c) => c.item !== 'dados_imobiliaria'), 'locação particular não cobra dados de imobiliária');

// ---------- confiança é função determinística, não palpite do LLM ----------
ok(conferir(base(), ctx()).confianca === conferir(base(), ctx()).confianca, 'confiança é determinística');
ok(feliz.confianca > 0 && feliz.confianca <= 1, 'confiança normalizada 0..1');
ok(conferir(semAss, ctx()).confianca < feliz.confianca, 'pendência derruba a confiança');

// ---------- ANTI-ESCOPO: o que o cliente proibiu de analisar ----------
const itens = feliz.conferencias.map((c) => c.item).join(',');
ok(!/valor|aluguel|multa|caucao|pagamento|legalidade|juridic/i.test(itens), 'nenhuma conferência toca cláusula comercial/legalidade (anti-escopo §7)');

// ---------- assimetria: na dúvida, PENDE ----------
const vazio = { tipo_documento: 'locacao_particular', paginas: [], campos: {}, assinaturas: [] };
const rVazio = conferir(vazio, ctx());
ok(rVazio.parecer !== 'aprovado', 'extração vazia jamais aprova (falso-APROVADO é o dano caro)');

console.log(falhas === 0 ? `\n✅ ${'todos os checks passaram'}` : `\n❌ ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
