// Testa o cálculo do Resumo Financeiro contra a fixture REAL do Attuale (jun/2026).
// Metodologia do Fernando; alvos validados ao vivo na API. Determinístico, sem rede.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  calcularReceita, calcularDespesa, calcularSaldo, calcularResumo,
  textoInformativo, montarResumoFinanceiro, fmtBRL, nomeMes,
  destaques, motivoResultado,
} from '../../gerador-relatorio-contas/src/resumo-financeiro.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'resumo-attuale-jun2026.json'), 'utf8'));

let pass = 0, fail = 0;
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  ✗ FALHOU:', msg); } }

// 1) RECEITA ajustada = 103.937,37 (exclui Fundo de Reserva + Rendimentos)
const rec = calcularReceita(fx.balancete);
ok(near(rec.ajustada, fx.esperado.receitaAjustada), `receita ajustada ${fmtBRL(rec.ajustada)} != ${fmtBRL(fx.esperado.receitaAjustada)}`);
ok(rec.exclusoes.some((e) => /fundo de reserva/i.test(e.descricao)), 'exclusao Fundo de Reserva ausente');
ok(rec.exclusoes.some((e) => /rendiment/i.test(e.descricao)), 'exclusao Rendimentos ausente');

// 2) DESPESA ajustada = 98.107,79
const desp = calcularDespesa(fx.balancete);
ok(near(desp.ajustada, fx.esperado.despesaAjustada), `despesa ajustada ${fmtBRL(desp.ajustada)} != ${fmtBRL(fx.esperado.despesaAjustada)}`);

// 3) SALDO total = 587.482,72
const saldo = calcularSaldo(fx.caixa);
ok(near(saldo.total, fx.esperado.saldoTotal), `saldo ${fmtBRL(saldo.total)} != ${fmtBRL(fx.esperado.saldoTotal)}`);
ok(near(saldo.saldoAnterior, 570881.00), `saldo anterior ${fmtBRL(saldo.saldoAnterior)} != 570.881,00`);

// 4) RESUMO consolidado (resultado + situação)
const r = calcularResumo(fx.balancete, fx.caixa);
ok(near(r.resultado, fx.esperado.resultado), `resultado ${fmtBRL(r.resultado)} != ${fmtBRL(fx.esperado.resultado)}`);
ok(r.situacao === 'Positiva', `situacao ${r.situacao} != Positiva`);

// 5) TEXTO informativo (positivo e negativo)
const txtPos = textoInformativo(r, 6);
ok(/superávit/i.test(txtPos) && /5\.829,58/.test(txtPos) && /junho/i.test(txtPos), 'texto positivo malformado: ' + txtPos);
const txtNeg = textoInformativo({ resultado: -1234.5 }, 3);
ok(/déficit/i.test(txtNeg) && /1\.234,50/.test(txtNeg) && /março/i.test(txtNeg), 'texto negativo malformado: ' + txtNeg);

// 6) montarResumoFinanceiro com deps injetável (fixture como API mock) — sem rede
const resultado = await montarResumoFinanceiro(
  { idCondominio: 169, ano: 2026, mes: 6, nomeCondominio: 'ATTUALE' },
  { balancete: async () => ({ nomeplanocontas: 'ATTUALE', itens: fx.balancete }), caixa: async () => fx.caixa },
);
ok(near(resultado.receitaAjustada, 103937.37) && near(resultado.despesaAjustada, 98107.79) && near(resultado.saldoTotal, 587482.72), 'montarResumo numeros errados');
ok(resultado.periodo.rotulo === 'junho/2026', 'rotulo periodo != junho/2026: ' + resultado.periodo.rotulo);
ok(resultado.situacao === 'Positiva' && !!resultado.texto && !!resultado.lgpd, 'montarResumo campos faltando');

// 7) DESTAQUES + MOTIVO (pedido do Fernando 23/07: incluir a categoria que impactou o resultado)
const dest = destaques(fx.balancete);
ok(dest.receitas.length > 0 && dest.despesas.length > 0, 'destaques vazios');
ok(/taxa condom/i.test(dest.receitas[0].descricao || ''), 'maior receita != Taxa Condominio: ' + dest.receitas[0]?.descricao);
ok(!dest.receitas.some((d) => /fundo de reserva|rendiment|taxa extra/i.test(d.descricao)), 'destaque de receita inclui categoria EXCLUIDA do calculo');
ok(!dest.despesas.some((d) => /investiment/i.test(d.descricao)), 'destaque de despesa inclui Investimento (deveria excluir)');
ok(!dest.receitas.some((d) => /^\d/.test(d.descricao)), 'descricao de destaque com prefixo numerico (deveria limpar)');
const mot = motivoResultado(r, dest);
ok(/positivo/i.test(mot) && /taxa condom/i.test(mot), 'motivo malformado: ' + mot);
ok(!!resultado.motivo && /positivo/i.test(resultado.motivo), 'montarResumo sem motivo');
ok(Array.isArray(resultado.destaques?.receitas) && resultado.destaques.receitas.length > 0, 'montarResumo sem destaques');

console.log(`\ntest_resumo_financeiro: ${pass} OK, ${fail} FALHOU`);
if (fail) process.exit(1);
