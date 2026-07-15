// test_valor_taxa.mjs — parser da composição da 2ª via + guard da soma. Determinístico, sem rede.
// Fixture = estrutura REAL da fatura do Superlógica (Lume, 15/07/2026), com PII removida.
// O que estes testes protegem:
//  - o guard da soma (rubricas == vl_total_recb) é o que impede a tool de reportar valor errado;
//  - "Acréscimos" (juros/multa por atraso) NÃO entra na composição — vl_total_recb não o inclui.
import assert from 'node:assert/strict';
import { _parseComposicao, _parseComposicaoPdf, _parseValorBR, _conferir } from '../src/valor_taxa.mjs';

let n = 0, ok = 0;
const t = (nome, fn) => { n++; try { fn(); ok++; console.log('  ok  ', nome); } catch (e) { console.log('  FALHA', nome, '\n       ', e.message); process.exitCode = 1; } };

// ---- fixture: a tabela "O que estou pagando?" como o Superlógica realmente emite (latin-1, <strong>, R$ colado)
const linha = (desc, val) => `<tr><td width='0' align='left' valign='top' class='item'><strong> ${desc}</strong></td>`
  + `<td width='0' align='right' valign='top' class='valor'>${val}</td></tr>`;
const FATURA = `<div class="corpoFatura"><div class="Composicao"><div id="corpoComposicao">
<h4>O que estou pagando?</h4><table width='100%' border='0'><tbody>
${linha('Taxa Condomínio Jul/2026', 'R$734,61')}
${linha('Taxa Extra AGO 22.06.26 - Parc. 1/5', 'R$56,67')}
${linha('Taxa Extra Investimentos - Parc. 4/9', 'R$37,91')}
${linha('Fundo de Reserva Jul/2026', 'R$36,73')}
${linha('Consumo de Pagto a maior ref Cobr. 1168858 06/2026', 'R$-4,68')}
${linha('Acréscimos', 'R$17,22')}
</tbody></table></div></div></div>`;

console.log('_parseValorBR:');
t('valor simples', () => assert.equal(_parseValorBR('R$734,61'), 734.61));
t('valor negativo (credito/pagto a maior)', () => assert.equal(_parseValorBR('R$-4,68'), -4.68));
t('milhar com ponto', () => assert.equal(_parseValorBR('R$1.008,69'), 1008.69));
t('tags e espaco em volta', () => assert.equal(_parseValorBR('<strong> R$36,73 </strong>'), 36.73));
t('lixo vira null (nunca 0 — 0 seria um valor plausivel e errado)', () => {
  assert.equal(_parseValorBR('consulte a administradora'), null);
  assert.equal(_parseValorBR(''), null);
  assert.equal(_parseValorBR(null), null);
});

console.log('\n_parseComposicao:');
const itens = _parseComposicao(FATURA);
t('acha as 6 linhas da tabela', () => assert.equal(itens.length, 6));
t('descricao vem limpa de tags e do espaco inicial', () => assert.equal(itens[0].descricao, 'Taxa Condomínio Jul/2026'));
t('taxa condominial e a 1a rubrica', () => assert.equal(itens[0].valor, 734.61));
t('credito negativo preservado', () => assert.equal(itens[4].valor, -4.68));
t('"Acréscimos" e marcado como ENCARGO (fica fora da composicao)', () => {
  assert.equal(itens[5].encargo, true);
  assert.equal(itens.filter((i) => i.encargo).length, 1);
});
t('rubricas de taxa NAO sao encargo', () => {
  for (const i of itens.slice(0, 5)) assert.equal(i.encargo, false, `${i.descricao} nao devia ser encargo`);
});

console.log('\nguard da soma (o que impede reportar valor errado):');
const soma = (arr) => Number(arr.filter((i) => !i.encargo).reduce((s, i) => s + i.valor, 0).toFixed(2));
t('soma das rubricas == vl_total_recb REAL do boleto (861.24)', () => assert.equal(soma(itens), 861.24));
t('somar o encargo junto QUEBRA o total (por isso ele sai)', () => {
  const comEncargo = Number(itens.reduce((s, i) => s + i.valor, 0).toFixed(2));
  assert.equal(comEncargo, 878.46);
  assert.notEqual(comEncargo, 861.24);
});
t('composicao ausente => lista vazia (tool responde indisponivel, nao inventa)', () => {
  assert.deepEqual(_parseComposicao('<html><body>Sair</body></html>'), []);
  assert.deepEqual(_parseComposicao(''), []);
});
t('SABOTAGEM: rubrica adulterada faz a soma NAO bater (o guard pega)', () => {
  const adulterado = FATURA.replace('R$734,61', 'R$999,99');
  assert.notEqual(soma(_parseComposicao(adulterado)), 861.24);
});

// ---- PDF: a 2ª via do boleto PAGO. Texto CORRIDO (sem quebras de linha) e o balancete do
// condomínio vem logo depois no mesmo arquivo — o bloco tem que ser recortado, não grepado.
console.log('\n_parseComposicaoPdf (boleto pago — fixture real do Lume 203):');
const PDF_TXT = 'LUME 56300773000148 ____________________________________________________________________ '
  + 'Composição da cobrança Taxa Condomínio Jul/2026 914,32 Taxa Extra AGO 22.06.26 - Parc. 1/5 56,67 '
  + 'Fundo de Reserva Jul/2026 45,72 Taxa Extra Investimentos - Parc. 4/9 37,91 '
  + '____________________________________________________________________ '
  + 'DEMONSTRATIVO DE RECEITAS E DESPESAS MAI/2026 % VALOR TAXA CONDOMÍNIO 87,86% 101.071,41 '
  + 'FUNDO DE RESERVA 4,42% 5.090,28 TOTAL DE RECEITAS 100,00% 115.039,50';
const pdfItens = _parseComposicaoPdf(PDF_TXT);
t('acha as 4 rubricas do bloco', () => assert.equal(pdfItens.length, 4));
t('NAO captura o balancete do condominio (ruido depois da regua)', () => {
  const descs = pdfItens.map((i) => i.descricao).join(' | ');
  assert.ok(!/101\.071|DEMONSTRATIVO|TOTAL DE RECEITAS/i.test(descs), `vazou ruido: ${descs}`);
  assert.ok(!pdfItens.some((i) => i.valor > 100000), 'capturou valor do balancete');
});
t('data na descricao (22.06.26) nao vira valor', () => {
  assert.equal(pdfItens[1].descricao, 'Taxa Extra AGO 22.06.26 - Parc. 1/5');
  assert.equal(pdfItens[1].valor, 56.67);
});
t('soma == vl_total_recb real do boleto pago (1054.62)', () => assert.equal(soma(pdfItens), 1054.62));
t('sem o marcador => vazio (nao tenta adivinhar no PDF inteiro)', () => {
  assert.deepEqual(_parseComposicaoPdf('DEMONSTRATIVO TAXA CONDOMÍNIO 87,86% 101.071,41'), []);
});

// ---- _conferir: as 4 leituras aceitas. Cada caso abaixo é um boleto REAL medido em 15/07.
console.log('\n_conferir (guard: alguma leitura consistente explica algum total da API?):');
t('caso normal: sem encargos == vl_total_recb (Lume 14238)', () => {
  const r = _conferir(itens, { vl_total_recb: '861.24', vl_emitido_recb: '861.24' });
  assert.equal(r.ok, true); assert.equal(r.total, 861.24);
});
t('pago em atraso: Multa/Juros DENTRO do total (Reserva do Campo 14329)', () => {
  const i = [
    { descricao: 'Taxa Condomínio', valor: 480.92, encargo: false },
    { descricao: 'Roçada e Limpeza Terreno', valor: 45, encargo: false },
    { descricao: 'Multa', valor: 10.52, encargo: true },
    { descricao: 'Juros', valor: 8.84, encargo: true },
  ];
  const r = _conferir(i, { vl_total_recb: '545.28', vl_emitido_recb: '545.28' });
  assert.equal(r.ok, true, 'devia aceitar via soma COM encargos');
  assert.equal(r.total, 545.28);
});
t('acordo: bate com vl_emitido_recb, nao com vl_total_recb (Allure 4025)', () => {
  const i = [{ descricao: 'Acordos', valor: 260.49, encargo: false }];
  const r = _conferir(i, { vl_total_recb: '265.69', vl_emitido_recb: '260.49' });
  assert.equal(r.ok, true); assert.equal(r.total, 260.49);
});
t('leitura que nao explica NENHUM total => REPROVA (o valor nao e reportado)', () => {
  const i = [{ descricao: 'Taxa Condomínio', valor: 100, encargo: false }];
  const r = _conferir(i, { vl_total_recb: '545.28', vl_emitido_recb: '545.28' });
  assert.equal(r.ok, false);
  assert.match(r.detalhe, /não fecha/);
});
t('boleto sem valor na API => REPROVA (nunca reporta soma sem conferencia)', () => {
  assert.equal(_conferir(itens, {}).ok, false);
  assert.equal(_conferir(itens, { vl_total_recb: '' }).ok, false);
});

console.log(`\n${ok}/${n} ok`);
if (ok !== n) process.exit(1);
