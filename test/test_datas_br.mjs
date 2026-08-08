// test_datas_br.mjs — conversão BR → MM/DD/AAAA (o formato que a API do Superlógica exige).
//
// Por que este teste existe: no teste dos 20 cadastros (07/08/2026) o caso 16 informou
// "entrada em 05/08/2026" (5 de agosto) e o rascunho gravou `05/08/2026` no campo que o ERP lê como
// MM/DD — ou seja, 8 de MAIO. Falhou 1 vez em 20, porque quem convertia era o MODELO. O card mostra
// uma data plausível e ninguém desconfia; a data vai para o contrato e para o aviso da portaria.
// Enquanto a conversão for do LLM, isso volta a acontecer — por isso virou código, e por isso o
// teste cobre os DOIS lados: o que tem de converter e o que tem de ser RECUSADO (nunca chutado).
import { paraDataApi, _mesPorNome } from '../src/write/datas.mjs';
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };
const vira = (entrada, esperado, msg) => {
  const r = paraDataApi(entrada);
  ok(r.ok === true && r.data === esperado, `${msg}: "${entrada}" → ${esperado} (veio ${r.ok ? r.data : 'ERRO:' + r.motivo})`);
};
const recusa = (entrada, msg) => {
  const r = paraDataApi(entrada);
  ok(r.ok === false && !!r.motivo, `${msg}: "${entrada}" recusado (veio ${r.ok ? r.data : 'ok=false'})`);
};

// ── O caso 16, verbatim ───────────────────────────────────────────────────────────────────────────
vira('05/08/2026', '08/05/2026', 'CASO 16 — 5 de agosto, não 8 de maio');
// O contrário do caso 16: se lesse como MM/DD, "10/08" viraria 8 de outubro.
vira('10/08/2026', '08/10/2026', 'dia dez de agosto (o que o modelo converteu certo no caso 10)');

// ── Dia > 12: não é ambíguo em nenhuma leitura, mas tem de sair certo ──────────────────────────────
vira('30/06/2026', '06/30/2026', 'dia 30');
vira('31/12/2026', '12/31/2026', 'virada de ano');
vira('01/01/2027', '01/01/2027', 'dia 1º de janeiro (idêntico nos dois formatos)');

// ── Como gente escreve de verdade ─────────────────────────────────────────────────────────────────
vira('5/8/2026', '08/05/2026', 'sem zero à esquerda');
vira('05-08-2026', '08/05/2026', 'separador hífen');
vira('05.08.2026', '08/05/2026', 'separador ponto');
vira(' 05/08/2026 ', '08/05/2026', 'com espaço em volta');
vira('2026-08-05', '08/05/2026', 'ISO (AAAA-MM-DD) é lido como ISO, não como BR');
vira('10 de agosto de 2026', '08/10/2026', 'por extenso');
vira('1 de março de 2027', '03/01/2027', 'por extenso com acento e sem zero');
vira('10 de Agosto de 2026', '08/10/2026', 'por extenso com maiúscula');

// ── Rede de segurança da transição: MM/DD que o modelo mandar por hábito ───────────────────────────
// "08/30/2026" lido como BR seria o mês 30, que não existe → a ÚNICA leitura possível é 30 de agosto.
// Aceitar aqui evita quebrar durante a virada do contrato; e como só entra quando é impossível
// interpretar de outro jeito, não reintroduz a ambiguidade que causou o bug.
vira('08/30/2026', '08/30/2026', 'MM/DD inequívoco (mês > 12 na leitura BR) é aceito como está');

// ── O que NÃO pode passar ─────────────────────────────────────────────────────────────────────────
recusa('', 'vazio');
recusa(null, 'nulo');
recusa(undefined, 'indefinido');
recusa('amanhã', 'palavra solta');
recusa('semana que vem', 'texto sem data');
recusa('05/08', 'sem o ano');
recusa('05/08/26', 'ano com 2 dígitos (1926 ou 2026? não se chuta)');
recusa('32/01/2026', 'dia 32 não existe');
recusa('30/02/2026', '30 de fevereiro não existe');
recusa('29/02/2027', '29 de fevereiro fora de ano bissexto');
recusa('00/08/2026', 'dia zero');
recusa('05/00/2026', 'mês zero');
recusa('13/13/2026', 'mês 13 dos dois lados');
recusa('10 de agosto', 'por extenso sem ano');
recusa('10 de agostoo de 2026', 'mês por extenso escrito errado');
recusa('2026/08/05', 'ano na frente com barra não é formato conhecido');
recusa(42, 'número não é data');
recusa({}, 'objeto não é data');

// 29/02 em ano bissexto É válido — o teste acima só pode recusar o ano NÃO bissexto
vira('29/02/2028', '02/29/2028', '29 de fevereiro em ano bissexto');

// ── A tabela de meses, dos dois lados ─────────────────────────────────────────────────────────────
ok(_mesPorNome('marco') === 3 && _mesPorNome('março') === 3, 'março casa com e sem cedilha');
ok(_mesPorNome('dezembro') === 12, 'dezembro = 12');
ok(_mesPorNome('mes') === null, 'palavra que não é mês → null');

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
