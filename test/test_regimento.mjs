// Teste do retriever de regimento (sem LLM): valida que as seções certas sobem para cada pergunta.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { consultar_regimento, classificarDoc, _reloadIndex } from '../src/regimento.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const casos = [
  { q: 'Posso ter cachorro no apartamento?', espera: /animais|pet/i },
  { q: 'Qual o horario permitido pra fazer mudanca?', espera: /mudan/i },
  { q: 'Posso fechar minha varanda com vidro?', espera: /varanda|fechamento/i },
  { q: 'Ate que horas posso usar a piscina?', espera: /piscina/i },
  { q: 'Como reservar o espaco gourmet pro fim de semana?', espera: /gourmet|festas|festa/i },
  { q: 'Morador lavando carro na garagem, pode?', espera: /garagem|veiculo|deveres/i },
  { q: 'Excesso de barulho a noite, qual a regra?', espera: /deveres|silencio|penalidade|disposi/i },
  { q: 'Tem regra pro lixo?', espera: /lixo/i },
  { q: 'O condominio tem convenio com academia externa?', espera: null }, // deve achar pouco/nada relevante
];

let ok = 0;
for (const { q, espera, } of casos) {
  const r = consultar_regimento({ condominio: 'lume', pergunta: q });
  const fontes = (r.trechos || []).map((t) => t.fonte);
  const top = fontes[0] || '(nenhum)';
  const acerto = espera ? fontes.some((f) => espera.test(f)) : true;
  if (acerto) ok++;
  console.log(`${acerto ? 'OK ' : 'XX '} "${q}"`);
  console.log(`     encontrou=${r.encontrou} | top: ${top}`);
  if (espera && !acerto) console.log(`     >>> esperava casar ${espera} em: ${fontes.join(' | ')}`);
}
console.log(`\n${ok}/${casos.length} recuperações no alvo`);

// isolamento / comportamento de "só responde do que tiver"
console.log('\n--- isolamento & disponibilidade ---');
const fora = consultar_regimento({ condominio: 'Jardim das Acacias', pergunta: 'posso ter cachorro?' });
console.log(`condo fora da base -> encontrou=${fora.encontrou} motivo=${fora.motivo} (esperado: false / condominio_sem_regimento)`);
const semCondo = consultar_regimento({ pergunta: 'posso ter cachorro?' });
console.log(`sem condomínio    -> encontrou=${semCondo.encontrou} motivo=${semCondo.motivo} (esperado: false / condominio_nao_informado — NÃO assume Lume)`);
const okLume = consultar_regimento({ condominio: 'Lume', pergunta: 'cachorro' });
console.log(`Lume (na base)    -> encontrou=${okLume.encontrou} top=${okLume.trechos?.[0]?.fonte}`);

// --- classificação de documento (3º tipo: ATA) -------------------------------
// Valida que o retriever reconhece ATAs pelo nome do arquivo e extrai a data p/ o label,
// SEM quebrar a detecção de convenção/regimento. (Não toca na base do Lume — função pura.)
console.log('\n--- classificação de documento (ata / convencao / regimento) ---');
let clsOk = 0;
const casosCls = [
  { f: 'ata-2025-03-12.md',                 tipo: 'ata',               label: 'ATA (12/03/2025)' },
  { f: 'ata-2024-11-08.md',                 tipo: 'ata',               label: 'ATA (08/11/2024)' },
  { f: 'assembleia-ordinaria.md',           tipo: 'ata',               label: 'ATA' }, // sem data no nome -> label sem data
  { f: 'assembleia-extraordinaria-2023-07-01.md', tipo: 'ata',        label: 'ATA (01/07/2023)' },
  { f: 'convencao-lume.md',                 tipo: 'convencao',         label: 'Convenção' },
  { f: 'regimento-interno-lume.md',         tipo: 'regimento-interno', label: 'Regimento Interno' },
];
for (const { f, tipo, label } of casosCls) {
  const d = classificarDoc(f);
  const acerto = d.docTipo === tipo && d.docLabel === label;
  if (acerto) clsOk++;
  console.log(`${acerto ? 'OK ' : 'XX '} ${f} -> tipo=${d.docTipo} label="${d.docLabel}"`);
  if (!acerto) console.log(`     >>> esperava tipo=${tipo} label="${label}"`);
}
console.log(`${clsOk}/${casosCls.length} classificações corretas`);

// --- ordenação cronológica das ATAs (mais recente primeiro) ------------------
// Reproduz a regra de desempate do retriever (mesmo score -> ATA mais recente sobe)
// sobre chunks-fixture em memória — não contamina nenhuma base de condomínio.
console.log('\n--- ordenação cronológica de ATAs (desempate por data desc) ---');
const ataChunks = [
  { docLabel: classificarDoc('ata-2024-11-08.md').docLabel, ataData: classificarDoc('ata-2024-11-08.md').ataData, s: 2 },
  { docLabel: classificarDoc('ata-2025-03-12.md').docLabel, ataData: classificarDoc('ata-2025-03-12.md').ataData, s: 2 },
  { docLabel: classificarDoc('ata-2023-07-01.md').docLabel, ataData: classificarDoc('ata-2023-07-01.md').ataData, s: 2 },
];
const ordenado = [...ataChunks].sort((a, b) => {
  if (b.s !== a.s) return b.s - a.s;
  const da = a.ataData ? a.ataData.getTime() : -Infinity;
  const db = b.ataData ? b.ataData.getTime() : -Infinity;
  return db - da;
});
const ordemEsperada = ['ATA (12/03/2025)', 'ATA (08/11/2024)', 'ATA (01/07/2023)'];
const ordemReal = ordenado.map((c) => c.docLabel);
const ordemOk = JSON.stringify(ordemReal) === JSON.stringify(ordemEsperada);
console.log(`${ordemOk ? 'OK ' : 'XX '} ordem: ${ordemReal.join(' > ')}`);
if (!ordemOk) console.log(`     >>> esperava: ${ordemEsperada.join(' > ')}`);

// --- integração ao vivo: loadIndex + ordenação cronológica + isolamento ------
// Cria um condomínio-FIXTURE descartável (NÃO toca Lume nem nenhum condo real),
// roda o retriever de ponta a ponta e SEMPRE remove a fixture no finally.
// Cobre a regressão: ATA mais recente tem que vir ANTES da antiga mesmo com scores
// diferentes (deliberação de assembleia nova prevalece sobre a velha).
console.log('\n--- integração: ATA ao vivo (fixture descartável) ---');
let intgOk = false;
const fxRoot = path.join(__dirname, '..', 'data', 'regimentos', '__test_ata_fixture__');
try {
  fs.mkdirSync(fxRoot, { recursive: true });
  fs.writeFileSync(path.join(fxRoot, '_meta.json'), JSON.stringify({ condominio: 'Test ATA Fixture' }));
  fs.writeFileSync(path.join(fxRoot, 'regimento-interno-fix.md'),
    '# I - DOS ANIMAIS\nAnimais de estimacao sao permitidos com guia e coleira nas areas comuns.');
  fs.writeFileSync(path.join(fxRoot, 'ata-2024-05-10.md'),
    '# ANIMAIS\nEm 2024 ficou deliberado o limite de um animal de estimacao por unidade.');
  fs.writeFileSync(path.join(fxRoot, 'ata-2025-09-20.md'),
    '# ANIMAIS\nNa assembleia mais recente foi deliberado ate dois animais de estimacao, revisando a regra anterior sobre animais.');

  _reloadIndex(); // o índice foi cacheado lá em cima (Lume) → recarregar p/ enxergar a fixture
  const r = consultar_regimento({ condominio: '__test_ata_fixture__', pergunta: 'posso ter animal de estimacao?' });
  const atas = (r.trechos || []).filter((t) => t.tipo === 'ata');
  const i2025 = atas.findIndex((t) => t.data === '20/09/2025');
  const i2024 = atas.findIndex((t) => t.data === '10/05/2024');
  // isolamento: sem condominio NÃO pode retornar conteúdo da fixture
  const semCondoIntg = consultar_regimento({ pergunta: 'animal' });
  intgOk = r.encontrou === true && r.contem_ata === true && !!r.aviso_ata
    && atas.length >= 2 && i2025 !== -1 && i2024 !== -1 && i2025 < i2024
    && atas[0].fonte.includes('ATA (') && semCondoIntg.encontrou === false;
  console.log(`${intgOk ? 'OK ' : 'XX '} contem_ata=${r.contem_ata} | ATA recente antes da antiga=${i2025 < i2024} | ordem=${atas.map((t) => t.data).join(' > ')}`);
} catch (e) {
  console.log('XX  erro na integração:', e.message);
} finally {
  fs.rmSync(fxRoot, { recursive: true, force: true });
  _reloadIndex(); // limpa o cache p/ não deixar a fixture removida fantasmando o índice
}

// --- resumo final (falha com exit!=0 se algo regrediu) -----------------------
const recOk = ok === casos.length;
const isolOk = fora.encontrou === false && fora.motivo === 'condominio_sem_regimento'
  && semCondo.encontrou === false && semCondo.motivo === 'condominio_nao_informado'
  && okLume.encontrou === true;
const tudoOk = recOk && clsOk === casosCls.length && ordemOk && isolOk && intgOk;
console.log(`\n=== RESUMO: recuperações=${recOk} | classificação=${clsOk === casosCls.length} | ordenação=${ordemOk} | isolamento=${isolOk} | integração=${intgOk} ===`);
console.log(tudoOk ? 'TODOS OS TESTES VERDES' : 'HÁ FALHAS');
if (!tudoOk) process.exit(1);
