// test_painel_alertas.mjs — o painel PRECISA exibir os `alertas` da ação.
// Motivo: quando o inquilino é o responsável pela cobrança, o aprovador tem de virar o proprietário
// para "só extras" no Superlógica; se esse aviso não chegar na TELA, o boleto sai duplicado e
// ninguém fica sabendo (é a falha silenciosa que a spec da Onda 1 §2.2 proíbe).
// Antes deste teste, renderPainel só exibia campos/snapshotResumo e o conflito — `alertas` era decoração.
import { renderPainel } from '../src/write/painel.mjs';
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

const base = { token: 'tk', acao: 'cadastro_inquilino', status: 'pendente', time: 'Recepção', conflito: null };
const comAlerta = { ...base, render: { campos: [{ label: 'Nome', valor: 'João' }], diff: [],
  alertas: ['Mude o proprietário da unidade 900 para "só cobranças extras" no Superlógica.'] } };
const html = renderPainel(comAlerta);
ok(html.includes('só cobranças extras'), 'exibe o texto do alerta na tela');
ok(html.includes('proprietário'), 'o alerta chega íntegro (com acento)');

// controle: sem alertas não inventa caixa vazia
const semAlerta = { ...base, render: { campos: [{ label: 'Nome', valor: 'João' }], diff: [], alertas: [] } };
ok(!renderPainel(semAlerta).includes('só cobranças extras'), 'sem alertas → não mostra alerta (controle)');

// robustez: ação sem o campo `alertas` (as antigas) não pode quebrar o painel
const legado = { ...base, render: { campos: [{ label: 'Nome', valor: 'João' }], diff: [] } };
let quebrou = false;
try { renderPainel(legado); } catch { quebrou = true; }
ok(!quebrou, 'render sem o campo alertas não quebra (compat com ações antigas)');

// segurança: alerta é dado de ação, mas passa pelo mesmo escape do resto do painel
const xss = { ...base, render: { campos: [], diff: [], alertas: ['<script>alert(1)</script>'] } };
ok(!renderPainel(xss).includes('<script>alert(1)</script>'), 'alerta é escapado (não injeta HTML)');

// ── selo verde (Fernando, 07/08: "nenhum tá verdinho... podia ter um verdinho") ────────────────────
// Sem ele, TODO card chega em vermelho/amarelo e o aprovador aprende a passar o olho por cima — que
// é o mesmo mecanismo pelo qual o alerta do boleto duplicado deixaria de ser lido.
const comSelo = { ...base, render: { campos: [], diff: [], alertas: [], selo: { tipo: 'ok', texto: 'Conferido: nada pendente neste cadastro.' } } };
ok(renderPainel(comSelo).includes('Conferido: nada pendente'), 'sem alertas → exibe o selo verde');
ok(/#dcfce7|#15803d/.test(renderPainel(comSelo)), 'o selo é verde de verdade (não é só texto)');
// A regra é da AÇÃO, mas a tela não pode contradizê-la: verde junto de pendência é pior que sem verde.
const seloComAlerta = { ...base, render: { campos: [], diff: [], alertas: ['Peça o contrato'], selo: { tipo: 'ok', texto: 'Conferido.' } } };
const htmlMisto = renderPainel(seloComAlerta);
ok(htmlMisto.includes('Peça o contrato') && !htmlMisto.includes('Conferido.'), 'selo + alerta → mostra o alerta e NÃO o verde');
ok(!renderPainel(semAlerta).includes('&#9989;'), 'ação sem selo → não inventa verde (compat com ações antigas)');

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
