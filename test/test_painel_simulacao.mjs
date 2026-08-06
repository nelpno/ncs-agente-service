// test_painel_simulacao.mjs — o painel de aprovação por LINK precisa dizer que está em simulação.
//
// Por que este teste existe: em 05/08/2026 o Fernando abriu o link de um cadastro real (contrato de
// locação lido pelo DocIA), clicou em Aprovar e o sistema respondeu "gravado" — mas DRY_RUN_WRITES
// estava ligado e NADA foi gravado no Superlógica. Ele só descobriu depois ("agora vi que vai para
// uma simulação"). O portal do Estagiário já tinha banner de modo teste; esta página, não.
//
// A regra de "vai gravar ou vai simular" NÃO é duplicada aqui: vem de vaiSimular(), a mesma função
// que o slPut usa para decidir. Banner que tem regra própria vira banner mentiroso.
process.env.DRY_RUN_WRITES = 'true';
const { renderPainel } = await import('../src/write/painel.mjs');
const { vaiSimular } = await import('../src/superlogica_write.mjs');

let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

const draft = {
  token: 'tk', acao: 'cadastro_inquilino', status: 'pendente', time: 'Recepção',
  render: { campos: [{ label: 'Nome', valor: 'Simone' }], diff: [], snapshotResumo: '1 contato hoje' },
};

// MARCA = o texto que o banner realmente usa. Procurar palavra que o banner NÃO escreve deixa o
// teste verde/vermelho pelo motivo errado — foi o que aconteceu na 1ª versão deste arquivo.
const MARCA = /MODO TESTE/i;

// ── 1. em simulação: avisa, e avisa ANTES do botão ────────────────────────────
const sim = renderPainel(draft, '', { simulacao: true });
ok(MARCA.test(sim), 'em simulação: a página avisa');
ok(/n[ãa]o grava/i.test(sim), 'o aviso diz explicitamente que NÃO grava no Superlógica');
const iAviso = sim.search(MARCA);
const iBotao = sim.indexOf('Aprovar</button>');
ok(iAviso >= 0 && iBotao >= 0 && iAviso < iBotao, 'o aviso vem ANTES do botão Aprovar');

// ── 2. gravando de verdade: NÃO avisa ─────────────────────────────────────────
// Banner que aparece sempre vira decoração e ninguém lê — o mesmo motivo pelo qual a etiqueta
// "atrasado" é retirada quando o humano responde.
const real = renderPainel(draft, '', { simulacao: false });
ok(!MARCA.test(real), 'escrita real: sem banner de simulação');

// ── 3. compatibilidade: chamada antiga (sem opts) segue funcionando ───────────
const antigo = renderPainel(draft, 'k1');
ok(antigo.includes('Simone') && antigo.includes('k1'), 'chamada sem opts continua renderizando');
ok(!MARCA.test(antigo), 'sem opts o default é NÃO alegar simulação (não inventar estado)');

// ── 4. a fonte da verdade é a mesma do slPut ──────────────────────────────────
process.env.WRITE_REAL_ACTIONS = '';
ok(vaiSimular('cadastro_inquilino') === true, 'DRY global + ação fora do allowlist => simula');
process.env.WRITE_REAL_ACTIONS = 'cadastro_inquilino';
ok(vaiSimular('cadastro_inquilino') === false, 'ação no WRITE_REAL_ACTIONS => grava de verdade');
ok(vaiSimular('titularidade') === true, 'outra ação segue simulando (allowlist é por ação)');
process.env.WRITE_REAL_ACTIONS = '';

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
