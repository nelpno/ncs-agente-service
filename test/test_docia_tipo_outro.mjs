// test_docia_tipo_outro.mjs — documento que NÃO é de locação (compra e venda, escritura, matrícula).
//
// O caso real que motivou (15/07): o Yohan mandou um contrato de compra e venda da CAIXA pedindo troca de
// titularidade. O DocIA classificou 'outro' CERTO e mesmo assim rodou o checklist de LOCAÇÃO — porque
// CHECKLIST['outro'] não existia e o código caía em locacao_particular. Resultado medido no papel real:
//   "contrato não traz o CPF de: locador, locatário"  ← o contrato traz os DOIS (vendedor e compradora)
//   "contrato não traz o prazo/término da locação"    ← é uma compra e venda, não tem prazo
// Isso é pendência FANTASMA: ensina o aprovador a passar o olho por cima e ignorar a pendência que importa.
//
// Determinístico: não chama o Gemini (a extração entra pronta como fixture).
import assert from 'node:assert';
import { conferir, CHECKLIST, STATUS } from '../src/docia/conferir.mjs';

let ok = 0;
const t = (nome, fn) => { try { fn(); console.log(`  ok  ${nome}`); ok++; } catch (e) { console.error(`  FALHOU  ${nome}\n      ${e.message}`); process.exitCode = 1; } };

const ctx = { hoje: new Date('2026-07-15T12:00:00Z'), erp: { unidade_existe: true, unidade_label: 'APTO 1002 / BLOCO 1' }, informado: {} };

// Compra e venda como o motor a enxerga: imóvel identificado, partes com CPF — mas nada de locação.
const compraVenda = {
  tipo_documento: 'outro',
  paginas: [{ n: 1, legibilidade: 'ok' }, { n: 2, legibilidade: 'ok' }],
  campos: {
    unidade: { valor: '1002', evidencia: 'apartamento nº 1002' },
    bloco: { valor: '1', evidencia: 'bloco 1' },
    condominio: { valor: 'VISTAS DO BOTANICO - CEDROS', evidencia: 'VISTAS DO BOTANICO' },
  },
  fatos: { paginas_completas: true },
};

console.log('\n[1] compra e venda não é cobrada como se fosse locação');

t("'outro' tem checklist próprio (sem os itens de locação)", () => {
  assert.ok(CHECKLIST.outro, "CHECKLIST.outro não existe → cai no de locação (o bug)");
  for (const proibido of ['vigencia_valida', 'cpf_partes', 'assinatura_locador', 'assinatura_locatario', 'maioridade_locatario', 'testemunhas']) {
    assert.ok(!CHECKLIST.outro.includes(proibido), `'${proibido}' é item de LOCAÇÃO e não pode ser cobrado de um documento 'outro'`);
  }
});

t('não inventa "faltou o CPF" num contrato que tem os CPFs', () => {
  const r = conferir(compraVenda, ctx);
  const texto = [...r.pendencias, ...r.divergencias].join(' | ');
  assert.ok(!/CPF de: locador|não traz o CPF/i.test(texto), `pendência fantasma de CPF voltou: ${texto}`);
});

t('não cobra prazo de locação de uma compra e venda', () => {
  const r = conferir(compraVenda, ctx);
  const texto = [...r.pendencias, ...r.divergencias].join(' | ');
  assert.ok(!/prazo|vig[êe]ncia|t[ée]rmino da loca/i.test(texto), `cobrou vigência de compra e venda: ${texto}`);
});

console.log('\n[2] mas DIZ o que o documento é — silêncio aqui seria pior que a pendência fantasma');

t('reprova (não segue como cadastro de inquilino)', () => {
  const r = conferir(compraVenda, ctx);
  assert.equal(r.parecer, 'reprovado', 'um documento que não é de locação não pode virar cadastro de inquilino');
});

t('explica o caminho certo (titularidade), sem jargão', () => {
  const r = conferir(compraVenda, ctx);
  const texto = r.divergencias.join(' | ');
  assert.ok(/n[ãa]o [ée] um contrato de loca/i.test(texto), `não disse que não é locação: ${texto}`);
  assert.ok(/titularidade/i.test(texto), `não apontou o caminho (titularidade): ${texto}`);
});

t('ainda aproveita o que ele CONSEGUE ler — a unidade do contrato', () => {
  const r = conferir(compraVenda, ctx);
  const imovel = r.conferencias.find((c) => c.item === 'identificacao_imovel');
  assert.equal(imovel.status, STATUS.OK, 'devia ter identificado o imóvel mesmo não sendo locação');
  assert.ok(/1002/.test(imovel.evidencia), 'perdeu a unidade que estava no papel');
});

console.log('\n[3] controle: a LOCAÇÃO não mudou (o fix não pode mexer no que já funciona)');

const locacao = {
  tipo_documento: 'locacao_particular',
  paginas: [{ n: 1, legibilidade: 'ok' }],
  campos: {
    unidade: { valor: '401', evidencia: 'apto 401' },
    locador: { nome: 'Fulano', cpf: '529.982.247-25', evidencia: 'x' },
    locatario: { nome: 'Beltrana', cpf: '111.444.777-35', data_nascimento: '1990-01-01', evidencia: 'y' },
    vigencia: { inicio: '2026-01-01', fim: '2028-01-01', evidencia: 'z' },
  },
  fatos: { paginas_completas: true },
};

t("checklist de locação segue com os itens de locação", () => {
  for (const item of ['vigencia_valida', 'cpf_partes', 'assinatura_locador', 'maioridade_locatario']) {
    assert.ok(CHECKLIST.locacao_particular.includes(item), `sumiu o item ${item} da locação`);
  }
  assert.ok(!CHECKLIST.locacao_particular.includes('tipo_documento'), 'o check de tipo é só do outro');
});

t('contrato de locação NÃO é reprovado pelo check de tipo', () => {
  const r = conferir(locacao, ctx);
  const texto = r.divergencias.join(' | ');
  assert.ok(!/n[ãa]o [ée] um contrato de loca/i.test(texto), `acusou locação de não ser locação: ${texto}`);
});

console.log(`\ntest_docia_tipo_outro: ${ok} OK`);
