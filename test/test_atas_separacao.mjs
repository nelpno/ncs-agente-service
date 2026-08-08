// test_atas_separacao.mjs — ATA só existe para quem pede (Estagiário). A Ana não enxerga.
//
// Por que este teste existe: o Fernando fechou em 07/08 que as atas entram "primeiro só no
// estagiário, eu e o Natanael testamos, aí replica na Ana". Como `src/regimento.mjs` é o MESMO
// módulo nos dois motores, a separação tem de ser estrutural — e provada nos DOIS lados, senão
// "só no Estagiário" é promessa, não garantia.
//
// A separação é por RAIZ, não por nome de arquivo: tudo que está em data/atas/ é ata, mesmo com
// nome fora do padrão. Com 276 arquivos vindos do Drive, nome fora do padrão é certeza — e um
// filtro que dependesse do nome falharia ABERTO (vazaria para a Ana, calado).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { consultar_regimento, _reloadIndex } from '../src/regimento.mjs';
import { _temPII } from '../src/pii_ata.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'data');
const REGS = path.join(DATA, 'regimentos');
const ATAS = path.join(DATA, 'atas');

const falhas = [];
const check = (nome, cond, detalhe = '') => {
  console.log(`${cond ? 'OK ' : 'XX '} ${nome}${detalhe ? ` | ${detalhe}` : ''}`);
  if (!cond) falhas.push(nome);
};

const SLUG = '__test_sep_atas__';
const SLUG_SO_ATA = '__test_so_ata__';
const fxReg = path.join(REGS, SLUG);
const fxAta = path.join(ATAS, SLUG);
const fxSoAta = path.join(ATAS, SLUG_SO_ATA);

try {
  fs.mkdirSync(fxReg, { recursive: true });
  fs.mkdirSync(fxAta, { recursive: true });
  fs.mkdirSync(fxSoAta, { recursive: true });

  fs.writeFileSync(path.join(fxReg, '_meta.json'), JSON.stringify({ condominio: 'Test Sep Atas' }));
  fs.writeFileSync(path.join(fxReg, 'regimento-interno-fix.md'),
    '# I - DOS ANIMAIS\nAnimais de estimacao sao permitidos com guia e coleira nas areas comuns do condominio.');

  // ata com nome no padrão
  fs.writeFileSync(path.join(fxAta, 'ata-2025-09-20.md'),
    '# ANIMAIS\nNa assembleia foi deliberado o limite de dois animais de estimacao por unidade.');
  // ata com nome FORA do padrão (o caso que o filtro-por-nome deixaria vazar)
  fs.writeFileSync(path.join(fxAta, 'AGO-convocacao-2026.md'),
    '# ANIMAIS\nDeliberacao de 2026 sobre animais de estimacao e circulacao nas areas comuns.');

  fs.writeFileSync(path.join(fxSoAta, '_meta.json'), JSON.stringify({ condominio: 'Test So Ata' }));
  fs.writeFileSync(path.join(fxSoAta, 'ata-2026-01-10.md'),
    '# TAXA\nFoi aprovado o reajuste da taxa condominial de estimacao orcamentaria para o exercicio.');

  _reloadIndex();

  // --- 1. a Ana (default) não vê ata ---------------------------------------
  const ana = consultar_regimento({ condominio: SLUG, pergunta: 'posso ter animal de estimacao?' });
  const anaTipos = (ana.trechos || []).map((t) => t.tipo);
  check('Ana acha o regimento do condo', ana.encontrou === true, `trechos=${anaTipos.length}`);
  check('Ana NÃO recebe nenhum trecho de ata', !anaTipos.includes('ata'), `tipos=${anaTipos.join(',')}`);
  check('Ana não recebe o aviso_ata', !ana.aviso_ata && ana.contem_ata !== true);

  // --- 2. o Estagiário vê ------------------------------------------------------
  const est = consultar_regimento({ condominio: SLUG, pergunta: 'posso ter animal de estimacao?', incluirAtas: true });
  const estTipos = (est.trechos || []).map((t) => t.tipo);
  check('Estagiário RECEBE trecho de ata', estTipos.includes('ata'), `tipos=${estTipos.join(',')}`);
  check('Estagiário recebe o aviso_ata', est.contem_ata === true && !!est.aviso_ata);

  // --- 3. falha FECHADA: nome fora do padrão dentro de data/atas/ --------------
  const temForaDoPadrao = (r) => (r.trechos || []).some((t) => /Deliberacao de 2026/.test(t.texto));
  check('arquivo com nome fora do padrão em data/atas/ NÃO chega na Ana', !temForaDoPadrao(ana));
  check('arquivo com nome fora do padrão em data/atas/ chega no Estagiário',
    temForaDoPadrao(consultar_regimento({ condominio: SLUG, pergunta: 'animais circulacao areas comuns', incluirAtas: true, k: 12 })));

  // --- 4. condo que SÓ tem ata: para a Ana ele não existe ----------------------
  const anaSoAta = consultar_regimento({ condominio: SLUG_SO_ATA, pergunta: 'aumentou a taxa?' });
  check('condo só-ata: Ana responde "não temos o regimento", não "nada relevante"',
    anaSoAta.encontrou === false && anaSoAta.motivo === 'condominio_sem_regimento', `motivo=${anaSoAta.motivo}`);
  const estSoAta = consultar_regimento({ condominio: SLUG_SO_ATA, pergunta: 'aumentou a taxa?', incluirAtas: true });
  check('condo só-ata: Estagiário encontra', estSoAta.encontrou === true, `trechos=${(estSoAta.trechos || []).length}`);

  // --- 5. dupla defesa: ata largada em data/regimentos/ também não vaza --------
  const intruso = path.join(fxReg, 'ata-2099-01-01.md');
  fs.writeFileSync(intruso, '# ANIMAIS\nAta gravada no lugar errado falando de animais de estimacao.');
  _reloadIndex();
  const anaIntruso = consultar_regimento({ condominio: SLUG, pergunta: 'animal de estimacao', k: 12 });
  check('ata gravada por engano em data/regimentos/ NÃO chega na Ana',
    !(anaIntruso.trechos || []).some((t) => /lugar errado/.test(t.texto)));
  fs.rmSync(intruso, { force: true });
  _reloadIndex();

} catch (e) {
  console.log('XX  erro na fixture:', e.message);
  falhas.push('fixture');
} finally {
  fs.rmSync(fxReg, { recursive: true, force: true });
  fs.rmSync(fxAta, { recursive: true, force: true });
  fs.rmSync(fxSoAta, { recursive: true, force: true });
  _reloadIndex();
}

// --- 6. guards estruturais sobre a base REAL ---------------------------------
console.log('\n--- guards sobre a base real ---');
const ehAta = (f) => /^ata-|assembleia/i.test(f);

const atasNoLugarErrado = [];
for (const slug of fs.readdirSync(REGS)) {
  const dir = path.join(REGS, slug);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.md') && ehAta(f)) atasNoLugarErrado.push(`${slug}/${f}`);
}
check('nenhuma ata em data/regimentos/ (lugar delas é data/atas/)',
  atasNoLugarErrado.length === 0, `${atasNoLugarErrado.length} fora do lugar${atasNoLugarErrado.length ? ': ' + atasNoLugarErrado.slice(0, 5).join(', ') : ''}`);
// auto-teste do guard acima: ele PRECISA detectar quando existe (senão é um check que nunca dispara)
check('  ↳ auto-teste: o guard acima detecta um arquivo de ata', ehAta('ata-2025-01-01.md') && ehAta('assembleia-geral.md') && !ehAta('convencao-x.md'));

const comPII = [];
if (fs.existsSync(ATAS)) {
  for (const slug of fs.readdirSync(ATAS)) {
    const dir = path.join(ATAS, slug);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      if (_temPII(fs.readFileSync(path.join(dir, f), 'utf8'))) comPII.push(`${slug}/${f}`);
    }
  }
}
check('nenhuma ata em data/atas/ com CPF/RG legível',
  comPII.length === 0, `${comPII.length} com PII${comPII.length ? ': ' + comPII.slice(0, 5).join(', ') : ''}`);
check('  ↳ auto-teste: o guard de PII detecta CPF e RG rotulados',
  _temPII('portador do CPF n.º 123.456.789-00') && _temPII('RG 8169562 -7') && !_temPII('valor de R$ 101.893,87 pela Lei 4.591/64'));

// --- 7. os DOIS MOTORES de verdade, com a MESMA pergunta -----------------------
// O aceite do Fernando é "traz no Estagiário e não traz na Ana". Testar só o retriever provaria
// que o mecanismo existe, não que cada motor está ligado do jeito certo — que é o que pode
// quebrar quando alguém editar o runTool. Por isso aqui entram as funções REAIS de cada agente.
console.log('\n--- os dois motores (runTool real de cada um) ---');
const fx2Reg = path.join(REGS, SLUG);
const fx2Ata = path.join(ATAS, SLUG);
try {
  fs.mkdirSync(fx2Reg, { recursive: true });
  fs.mkdirSync(fx2Ata, { recursive: true });
  fs.writeFileSync(path.join(fx2Reg, '_meta.json'), JSON.stringify({ condominio: 'Test Sep Atas' }));
  fs.writeFileSync(path.join(fx2Reg, 'regimento-interno-fix.md'),
    '# I - DA TAXA\nA taxa condominial e devida mensalmente por cada unidade autonoma.');
  fs.writeFileSync(path.join(fx2Ata, 'ata-2026-04-11.md'),
    '# TAXA\nFoi aprovado em assembleia o reajuste da taxa condominial a partir do mes seguinte.');
  _reloadIndex();

  const { runToolReal } = await import('../src/agent.mjs');
  const { runTool: runToolEstagiario } = await import('../estagiario/src/agent.mjs');
  const pergunta = { condominio: 'Test Sep Atas', pergunta: 'aumentou a taxa de condominio?' };

  const rAna = await runToolReal('consultar_regimento', { ...pergunta }, {});
  const rEst = await runToolEstagiario('consultar_regimento', { ...pergunta }, {});
  const tiposAna = (rAna.trechos || []).map((t) => t.tipo);
  const tiposEst = (rEst.trechos || []).map((t) => t.tipo);
  check('MOTOR Ana: mesma pergunta, NENHUM trecho de ata', !tiposAna.includes('ata'), `tipos=${tiposAna.join(',') || '(vazio)'}`);
  check('MOTOR Estagiário: mesma pergunta, TRAZ a ata', tiposEst.includes('ata'), `tipos=${tiposEst.join(',') || '(vazio)'}`);

  // o LLM não pode ligar a ata sozinho: mesmo alucinando o campo, a Ana continua sem ata
  const rAnaForcado = await runToolReal('consultar_regimento', { ...pergunta, incluirAtas: true }, {});
  check('MOTOR Ana: LLM mandando incluirAtas:true NÃO liga a ata',
    !((rAnaForcado.trechos || []).some((t) => t.tipo === 'ata')));
} catch (e) {
  console.log('XX  erro no teste dos dois motores:', e.message);
  falhas.push('dois motores');
} finally {
  fs.rmSync(fx2Reg, { recursive: true, force: true });
  fs.rmSync(fx2Ata, { recursive: true, force: true });
  _reloadIndex();
}

console.log(`\n=== ${falhas.length === 0 ? 'TODOS OS TESTES VERDES' : `HÁ FALHAS: ${falhas.join(' | ')}`} ===`);
if (falhas.length) process.exit(1);
