// test_cobranca_mensagem.mjs — compositor da mensagem de cobrança (assunto + corpo) a partir de template + dados.
// LGPD (Fable): NADA de valor/dívida no ASSUNTO. Placeholders {{...}} todos substituídos. Determinístico.
import { comporMensagem, formatBRL, ASSUNTOS, carregarTemplate } from '../src/cobranca/mensagem.mjs';

let falhas = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK ' : 'FALHA'} ${msg}`); if (!cond) falhas++; };

const TPL = 'Olá {{nome}}, sobre a unidade {{unidade}} do {{condominio}}: valor atualizado R$ {{valor}} (venc. original {{vencimento}}). 2ª via: {{link_2via}}. Se já pagou, desconsidere.';
const dados = { nome: 'Ana', condominio: 'Reserva do Campo', unidade: 'Apto 101', valor_corrigido: 1270.8, vencimento: '20/10/2019', link_2via: 'https://sl/2via/abc', etapa: 1 };

// formatBRL: número → pt-BR com 2 casas
ok(formatBRL(1270.8) === '1.270,80', `formatBRL(1270.8) = 1.270,80 (${formatBRL(1270.8)})`);
ok(formatBRL(640) === '640,00', `formatBRL(640) = 640,00 (${formatBRL(640)})`);

const m = comporMensagem(dados, TPL);

// 1) assunto NÃO expõe valor nem a palavra "dívida"; menciona condomínio/unidade
ok(!/\d{2,}/.test(m.assunto.replace(/101/, '')) , `assunto sem valor numérico da dívida ("${m.assunto}")`);
ok(!/d[íi]vida/i.test(m.assunto), `assunto não contém "dívida" ("${m.assunto}")`);
ok(/Reserva do Campo/.test(m.assunto), `assunto menciona o condomínio ("${m.assunto}")`);

// 2) corpo: placeholders todos substituídos, valor formatado, link presente
ok(!m.corpo.includes('{{'), `corpo sem placeholders remanescentes`);
ok(m.corpo.includes('Ana') && m.corpo.includes('Apto 101') && m.corpo.includes('Reserva do Campo'), `corpo com nome/unidade/condomínio`);
ok(m.corpo.includes('1.270,80'), `corpo com valor formatado 1.270,80 (${m.corpo.includes('1.270,80')})`);
ok(m.corpo.includes('https://sl/2via/abc'), `corpo com link da 2ª via`);

// 3) assunto muda por etapa (usa ASSUNTOS[etapa])
{ const m1 = comporMensagem({ ...dados, etapa: 1 }, TPL);
  const m3 = comporMensagem({ ...dados, etapa: 3 }, TPL);
  ok(m1.assunto !== m3.assunto, `assunto da etapa 1 difere da etapa 3 ("${m1.assunto}" vs "${m3.assunto}")`);
  ok(typeof ASSUNTOS[1] === 'string' && typeof ASSUNTOS[3] === 'string', 'ASSUNTOS tem etapas 1..3'); }

// 4) placeholder sem valor no dado → vira string vazia (não quebra, não deixa {{}})
{ const m0 = comporMensagem({ nome: 'X', condominio: 'C', unidade: 'U', valor_corrigido: 0, vencimento: '', link_2via: '', etapa: 1 }, TPL);
  ok(!m0.corpo.includes('{{') && !m0.corpo.includes('undefined'), `dados faltando -> sem {{}} nem undefined`); }

// 5) templates REAIS em disco (data/templates/cobranca-etapa1..3.md) carregam e compõem sem placeholder órfão
for (const etapa of [1, 2, 3]) {
  const tpl = carregarTemplate(etapa);
  const mm = comporMensagem({ ...dados, etapa }, tpl);
  ok(!mm.corpo.includes('{{') && mm.corpo.includes('1.270,80') && /desconsidere/i.test(mm.corpo),
    `template etapa ${etapa}: compõe, valor presente, "se já pagou desconsidere" presente`);
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(falhas ? 1 : 0);
