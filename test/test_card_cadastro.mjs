// test_card_cadastro.mjs — o que o APROVADOR vê antes de decidir.
//
// Os quatro defeitos que este teste tranca vieram do teste dos 20 (07/08/2026) e da reunião com o
// Fernando no mesmo dia:
//
//  (2) O aviso "Sem e-mail: é para onde o boleto é enviado" saía também para DEPENDENTE, que não
//      recebe boleto — e o próprio card diz, duas linhas acima, que o boleto vai para o proprietário.
//      Contradição dentro do mesmo card. Alarme falso repetido ensina a equipe a passar o olho por
//      cima, e aí o alerta do caso 4 (boleto duplicado), que é verdadeiro e caro, passa batido.
//  (8) O card não mostrava NINGUÉM que já mora na unidade. No caso 12 a unidade tinha 3 moradores.
//  (4) A Ana comparava o nome citado só com o PROPRIETÁRIO (é o único que o resolver_cadastro
//      devolve) e deu alarme falso num inquilino de 2 anos. Quem compara agora é o card, que vê
//      todos os contatos — a Ana não tem como verificar identidade no WhatsApp e parou de tentar.
//      Fernando (00:14:55): "tem que ser pelo titular do imóvel... que tá vinculado à unidade".
//  (—) Fernando (00:14:55 e 00:19:16): "Ela teria que ter mandado o contrato" / "sempre que é
//      locação tem contrato... senão não tem como fazer".
//  (—) Fernando (00:51:57): "nenhum tá verdinho... podia ter um verdinho, a pessoa: checklist já
//      pegou tudo". O verde é o que faz o vermelho significar alguma coisa.
import { cadastroInquilino } from '../src/write/actions/cadastro_inquilino.mjs';
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };
const alertasDe = (d, snap = [], opts = {}) => (cadastroInquilino.render(d, snap, opts).alertas || []).join(' | ');
const campo = (d, snap, label, opts = {}) => (cadastroInquilino.render(d, snap, opts).campos || []).find((c) => c.label === label);

const inquilino = { id_condominio: '172', id_unidade: '900', unidade_label: 'APTO / 041', nome: 'Mariana Ferreira Lopes',
  papel: 'inquilino', data_entrada: '08/01/2026', cpf: '12345678901', email: 'mariana@x.com', telefone: '16999998888' };
const dependente = { id_condominio: '172', id_unidade: '901', unidade_label: 'APTO / 011', nome: 'Lucas Prado Camargo',
  papel: 'dependente', data_entrada: '08/01/2026' };
// A unidade do caso 12: proprietário + inquilino (o "Ricardo" do alarme falso) + um dependente.
const unidadeCom3 = [
  { st_nome_con: 'Ricardo Prado Camargo', id_label_tres: '7', dt_saida_res: '' },
  { st_nome_con: 'Marta Souza Lima', id_label_tres: '1', dt_saida_res: '' },
  { st_nome_con: 'Bia Prado Camargo', id_label_tres: '4', dt_saida_res: '' },
];

// ── (2) o aviso de e-mail/telefone não persegue dependente ────────────────────────────────────────
ok(!/Sem e-mail/i.test(alertasDe(dependente)), 'DEPENDENTE sem e-mail → NÃO alerta (ele não recebe boleto)');
ok(!/Sem telefone/i.test(alertasDe(dependente)), 'DEPENDENTE sem telefone → NÃO alerta');
// Controle: para inquilino o alerta continua existindo — é lá que ele é verdadeiro.
const inqSemEmail = { ...inquilino }; delete inqSemEmail.email;
ok(/Sem e-mail/i.test(alertasDe(inqSemEmail)), 'INQUILINO sem e-mail → alerta (controle: não silenciei o caso real)');
const inqSemTel = { ...inquilino }; delete inqSemTel.telefone;
ok(/Sem telefone/i.test(alertasDe(inqSemTel)), 'INQUILINO sem telefone → alerta (controle)');

// ── (8) quem já está na unidade aparece no card ───────────────────────────────────────────────────
const cQuem = campo(dependente, unidadeCom3, 'Quem já está na unidade');
ok(!!cQuem, 'card tem a linha "Quem já está na unidade"');
ok(/Ricardo Prado Camargo/.test(cQuem?.valor || ''), 'lista o inquilino da unidade');
ok(/Marta Souza Lima/.test(cQuem?.valor || ''), 'lista o proprietário da unidade');
ok(/Bia Prado Camargo/.test(cQuem?.valor || ''), 'lista o dependente da unidade');
ok(/propriet/i.test(cQuem?.valor || '') && /inquilin/i.test(cQuem?.valor || ''), 'diz o papel de cada um, não só o nome');
// Quem SAIU não conta como morador atual (senão o aprovador confere contra gente que não mora mais).
const comExMorador = [...unidadeCom3, { st_nome_con: 'Ex Morador', id_label_tres: '7', dt_saida_res: '01/15/2024' }];
ok(!/Ex Morador/.test(campo(dependente, comExMorador, 'Quem já está na unidade')?.valor || ''), 'contato com data de saída não é listado');
// Unidade vazia não vira linha em branco nem texto estranho.
ok(/ningu[ée]m|nenhum/i.test(campo(dependente, [], 'Quem já está na unidade')?.valor || ''), 'unidade sem contatos → diz isso com todas as letras');

// ── (4) quem pediu, e a regra do titular para DEPENDENTE ──────────────────────────────────────────
const depPedidoPorEstranho = { ...dependente, solicitante_nome: 'Joana Silva Alheia' };
ok(/Joana Silva Alheia/.test(campo(depPedidoPorEstranho, unidadeCom3, 'Quem pediu')?.valor || ''), 'card mostra quem pediu');
ok(/titular/i.test(alertasDe(depPedidoPorEstranho, unidadeCom3)), 'DEPENDENTE pedido por quem não está na unidade → alerta da regra do titular');
// O caso 12: quem pede é o inquilino da unidade. É o caso MAIS COMUM e não pode alarmar.
const depPedidoPeloInquilino = { ...dependente, solicitante_nome: 'Ricardo Prado Camargo' };
ok(!/titular/i.test(alertasDe(depPedidoPeloInquilino, unidadeCom3)), 'CASO 12: pedido pelo inquilino da unidade → SEM alerta');
const depPedidoPeloDono = { ...dependente, solicitante_nome: 'marta souza lima' };
ok(!/titular/i.test(alertasDe(depPedidoPeloDono, unidadeCom3)), 'pedido pelo proprietário (caixa/acento diferentes) → sem alerta');
// Sem saber quem pediu, não se acusa ninguém: o alerta vira "pergunte", não "está errado".
ok(!/n[ãa]o (é|e) o titular/i.test(alertasDe(dependente, unidadeCom3)), 'sem solicitante informado → não afirma que a pessoa errada pediu');
// A regra é de DEPENDENTE (liberação de acesso). Inquilino pode ser cadastrado por imobiliária —
// caso que o próprio Fernando descreveu como legítimo (00:43:11 e 00:47:30).
ok(!/titular/i.test(alertasDe({ ...inquilino, solicitante_nome: 'Goya Imobiliária' }, unidadeCom3)), 'INQUILINO pedido pela imobiliária → sem alerta de titular');

// ── contrato de locação ausente (Fernando: "Ela teria que ter mandado o contrato") ─────────────────
ok(/contrato/i.test(alertasDe(inquilino, unidadeCom3, { dociaAtivo: true })), 'INQUILINO sem laudo de contrato → alerta');
ok(!/contrato/i.test(alertasDe(dependente, unidadeCom3, { dociaAtivo: true })), 'DEPENDENTE não precisa de contrato (Fernando 00:14:55)');
ok(!/contrato/i.test(alertasDe(inquilino, unidadeCom3, { dociaAtivo: false })), 'com a leitura de contrato desligada, não cobra o que não dá para receber');
const comLaudo = { ...inquilino, laudo: { parecer: 'aprovado', conferencias: [{ status: 'ok' }], divergencias: [], pendencias: [] } };
ok(!/n[ãa]o (veio|recebi)/i.test(alertasDe(comLaudo, unidadeCom3, { dociaAtivo: true })), 'contrato conferido → não cobra contrato');
// ⚠️ Quem responde "a leitura estava ligada?" é o RASCUNHO, não o ambiente: o card é desenhado pelo
// ncs-agente (que tem DOCIA_ATIVO) E pelo ncs-chat (Portal, que NÃO tem). Pelo ambiente, o alerta
// apareceria no painel por link e sumiria na tela onde a equipe aprova.
ok(/contrato/i.test(alertasDe({ ...inquilino, docia_ativo: true }, unidadeCom3)), 'o rascunho diz que a leitura estava ligada → alerta, sem depender do env');
ok(!/contrato/i.test(alertasDe({ ...inquilino, docia_ativo: false }, unidadeCom3)), 'o rascunho diz que estava desligada → sem alerta, sem depender do env');

// ── selo verde (Fernando 00:51:57) ────────────────────────────────────────────────────────────────
const limpo = cadastroInquilino.render(depPedidoPeloInquilino, unidadeCom3, { dociaAtivo: false });
ok(limpo.alertas.length === 0, 'o cenário limpo realmente não tem alerta (senão o teste do selo não vale nada)');
ok(limpo.selo?.tipo === 'ok' && typeof limpo.selo.texto === 'string' && limpo.selo.texto.length > 0, 'sem alerta → selo verde com texto');
const sujo = cadastroInquilino.render(inqSemEmail, unidadeCom3, { dociaAtivo: false });
ok(sujo.alertas.length > 0 && !sujo.selo, 'com alerta → NÃO tem selo verde (o verde não pode conviver com pendência)');

// ── nada disso pode ter quebrado o que já existia ─────────────────────────────────────────────────
const comFlip = { ...inquilino, responsavel_cobranca: 'inquilino' };
ok(/só cobranças extras/i.test(alertasDe(comFlip, unidadeCom3)), 'REGRESSÃO: o alerta do boleto duplicado continua saindo');
ok(campo(inquilino, unidadeCom3, 'Unidade')?.valor === 'APTO / 041', 'REGRESSÃO: unidade continua com o rótulo humano');
ok(campo(inquilino, unidadeCom3, 'Entrada')?.valor === '01/08/2026', 'REGRESSÃO: a entrada continua exibida em DD/MM para gente');
ok(cadastroInquilino.render(inquilino, unidadeCom3).resumo.includes('Mariana Ferreira Lopes'), 'REGRESSÃO: resumo intacto');
// A assinatura antiga (sem o 3º argumento) não pode quebrar: server.mjs e o Portal chamam com 2.
let quebrou = false;
try { cadastroInquilino.render(inquilino, unidadeCom3); } catch { quebrou = true; }
ok(!quebrou, 'REGRESSÃO: render(dados, snapshot) sem o 3º argumento continua funcionando');

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
