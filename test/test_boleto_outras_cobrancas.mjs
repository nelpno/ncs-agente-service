/**
 * test_boleto_outras_cobrancas.mjs — determinístico, sem API/LLM.
 *
 * Contexto (27/07/2026): a régua de 2ª via (`cobranca/index`) NÃO enxerga boleto vencido há mais de
 * ~30 dias — medido na API: nem com `status=todos` o atraso passa de ~21 dias. A Ana entregava o
 * boleto recente e a pessoa saía achando que era o único débito. Foi o que gerou a conv 219 (Ana:
 * "2 cobranças" × cobrança: "mês 5, 6 e 7") e a conv 186, onde o Fernando pediu por escrito
 * "colocar para verificar que tem boletos mais antigos em aberto".
 *
 * `calcularOutrasCobrancas` responde quantas cobranças existem ALÉM da que está sendo entregue.
 * Premissa (documentada na função): `qtd_cobrancas_em_aberto` da inadimplência conta cobranças
 * VENCIDAS — então o boleto entregue só está nesse total se ele próprio já venceu.
 *
 * Rodar: node test/test_boleto_outras_cobrancas.mjs
 */
import { calcularOutrasCobrancas, NOTA_PIX_INDISPONIVEL } from '../src/superlogica.mjs';

let ok = 0, fail = 0;
const t = (nome, real, esperado) => {
  if (real === esperado) { ok++; console.log('  ✓', nome); }
  else { fail++; console.log('  ✗', nome, '— esperado', esperado, 'veio', real); }
};

console.log('\n=== Boleto entregue JÁ VENCIDO (ele conta no total da inadimplência) ===');
t('3 em aberto, entregando 1 vencido → avisa 2 (caso conv 219)', calcularOutrasCobrancas(3, 5), 2);
t('2 em aberto, entregando 1 vencido → avisa 1', calcularOutrasCobrancas(2, 1), 1);
t('1 em aberto (só o que entregamos) → NÃO avisa', calcularOutrasCobrancas(1, 10), 0);
t('0 em aberto → NÃO avisa', calcularOutrasCobrancas(0, 10), 0);

console.log('\n=== Boleto entregue A VENCER (não entra na inadimplência) ===');
t('2 vencidas antigas + boleto a vencer → avisa as 2', calcularOutrasCobrancas(2, 0), 2);
t('1 vencida antiga + boleto a vencer → avisa 1 (caso conv 186, 63 dias)', calcularOutrasCobrancas(1, -7), 1);
t('nada vencido + boleto a vencer → NÃO avisa', calcularOutrasCobrancas(0, -3), 0);

console.log('\n=== Robustez (nunca inventar número nem quebrar) ===');
t('qtd null → 0', calcularOutrasCobrancas(null, 5), 0);
t('qtd undefined → 0', calcularOutrasCobrancas(undefined, 5), 0);
t('qtd string numérica é aceita', calcularOutrasCobrancas('4', 2), 3);
t('qtd não-numérica → 0', calcularOutrasCobrancas('muitas', 2), 0);
t('qtd negativa → 0 (nunca negativo)', calcularOutrasCobrancas(-2, 5), 0);
t('diasVencido ausente = trata como a vencer', calcularOutrasCobrancas(2, undefined), 2);
t('resultado nunca é negativo', calcularOutrasCobrancas(1, 99) >= 0, true);

// ---------------------------------------------------------------------------
// PIX ausente é PERMANENTE, não "tenta de novo". O Fernando confirmou (27/07) que o boleto do
// Parque Atlanta é emitido pelo SICOOB, não pelo Superlógica — por isso 0 de 174 boletos têm PIX,
// contra 100% no Lume/Vancouver. A Ana vinha dizendo "no momento não consegui obter o PIX", que soa
// como falha nossa e faz o morador tentar de novo à toa.
// Conferimos a constante REAL do módulo: uma cópia do texto aqui passaria mesmo com o código
// dizendo outra coisa.
console.log('\n=== PIX ausente: o texto não pode sugerir falha temporária ===');
t('não diz "no momento"', /no momento/i.test(NOTA_PIX_INDISPONIVEL), false);
t('não diz "não consegui"', /n[ãa]o consegui/i.test(NOTA_PIX_INDISPONIVEL), false);
t('não promete nova tentativa', /tente (de )?novo|novamente|mais tarde/i.test(NOTA_PIX_INDISPONIVEL), false);
t('explica o motivo (outro banco)', /outro banco/i.test(NOTA_PIX_INDISPONIVEL), true);
t('dá o caminho alternativo (link + código de barras)',
  /link/i.test(NOTA_PIX_INDISPONIVEL) && /c[óo]digo de barras/i.test(NOTA_PIX_INDISPONIVEL), true);

console.log(`\n${fail === 0 ? '✅' : '❌'} ${ok} passaram, ${fail} falharam\n`);
process.exit(fail === 0 ? 0 : 1);
