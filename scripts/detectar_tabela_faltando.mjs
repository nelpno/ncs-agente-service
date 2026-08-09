// detectar_tabela_faltando.mjs — aponta as atas que ANUNCIAM valores e não os apresentam.
//
// Por que existe: parte das atas traz a tabela de rateio como IMAGEM dentro do PDF, e nenhum
// extrator de texto a alcança. O `.md` fica com "foram aprovados os seguintes valores:" seguido
// direto de "Após a análise dos valores" — sem um único número — e continua parecendo uma ata
// completa. Sem este detector a perda é silenciosa, que é exatamente como ela passou despercebida
// até alguém comparar o arquivo com o PDF de origem.
//
// A saída é a lista de candidatas a `scripts/ocr_imagens_ata.py --ocr`. É um FILTRO, não um
// veredito: serve para não baixar 276 PDFs, e erra de propósito para o lado de apontar demais.
//
//   node scripts/detectar_tabela_faltando.mjs            (todas)
//   node scripts/detectar_tabela_faltando.mjs <slug>...  (só estes)
//   node scripts/detectar_tabela_faltando.mjs --autoteste
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ATAS = path.join(__dirname, '..', 'data', 'atas');

// frases que ANUNCIAM números logo a seguir
const ANUNCIA = /(?:os\s+seguintes\s+valores|valores\s+(?:abaixo|a\s+seguir)|conforme\s+(?:a\s+)?tabela|tabela\s+(?:abaixo|a\s+seguir)|planilha\s+(?:abaixo|a\s+seguir)|conforme\s+segue)\s*[:.]/gi;
// o que conta como "apresentou o número"
const TEM_NUMERO = /R\$\s?[\d.]+,\d{2}|\d+,\d{2}|\d+\s*%/;
const JANELA = 400; // caracteres depois do anúncio em que o número deveria aparecer

/** analisar(texto) → { anuncios, secos, jaRecuperada, suspeita, motivo } — puro, sem I/O */
export function analisar(texto) {
  const t = String(texto || '');
  const secos = [];
  for (const m of t.matchAll(ANUNCIA)) {
    const inicio = m.index + m[0].length;
    if (!TEM_NUMERO.test(t.slice(inicio, inicio + JANELA))) {
      secos.push({ frase: m[0].trim(), pos: m.index });
    }
  }
  // 2º sinal: a ata delibera rateio/orçamento e não tem NENHUM valor no documento inteiro
  const falaDeDinheiro = /rateio|or[çc]amento|reajuste|taxa\s+condominial|previs[ãa]o\s+or[çc]ament/i.test(t);
  const semNenhumValor = !/R\$\s?[\d.]+,\d{2}/.test(t);
  return {
    anuncios: secos.length,
    secos,
    jaRecuperada: /## Conteúdo recuperado de imagem/.test(t),
    // 🔴 SÓ o sinal forte ("anuncia valores e não apresenta") vira candidata. O sinal fraco
    // ("delibera dinheiro e não tem nenhum valor") foi MEDIDO contra um controle e reprovou: as 4
    // atas do Park foram provadas SEM imagem nenhuma (page.get_images = 0) e ele apontava uma
    // delas. Ata que decide "manter a taxa sem reajuste" fala de dinheiro e não tem valor —
    // é conteúdo legítimo, não perda. Fica como aviso informativo, fora da lista de candidatas.
    suspeita: secos.length > 0,
    informativo: secos.length === 0 && falaDeDinheiro && semNenhumValor,
    motivo: secos.length > 0 ? 'anuncia valores e não apresenta' : null,
  };
}

function autoteste() {
  // Guard que nunca dispara é ruído; guard que dispara sempre manda baixar 276 PDFs à toa.
  const casos = [
    ['pega o caso real do Lume',
      analisar('foram aprovados os seguintes valores: \n \nApós a análise dos valores, o síndico').suspeita === true],
    ['NÃO acusa quando os valores estão logo abaixo',
      analisar('foram aprovados os seguintes valores: Calhas R$ 8.800,00 e Cobertura R$ 13.500,00').suspeita === false],
    // ⚠️ POLÍTICA TROCADA: até 09/08 isto era candidata. Reprovou contra controle — as 4 atas do
    // Park foram provadas SEM imagem (page.get_images = 0) e uma delas era apontada só por aqui.
    // Ata que decide "manter a taxa sem reajuste" fala de dinheiro e não tem valor, e está certa.
    ['ata que só delibera dinheiro NÃO é candidata (vira aviso informativo)',
      analisar('Foi deliberado o rateio da obra entre as unidades, aprovado por unanimidade.').suspeita === false],
    ['...mas fica registrada como informativa',
      analisar('Foi deliberado o rateio da obra entre as unidades, aprovado por unanimidade.').informativo === true],
    ['NÃO acusa ata sem assunto financeiro',
      analisar('Foi deliberado o regulamento de convivência dos animais de estimação.').suspeita === false],
    ['reconhece o que já teve a imagem recuperada',
      analisar('os seguintes valores: \n\n## Conteúdo recuperado de imagem\n').jaRecuperada === true],
  ];
  let falhas = 0;
  for (const [nome, ok] of casos) { console.log(`${ok ? 'OK ' : 'FALHA'} ${nome}`); if (!ok) falhas++; }
  console.log(falhas ? `${falhas} FALHA(S)` : 'TODOS VERDES');
  return falhas ? 1 : 0;
}

// guard de entrypoint: importar o módulo (no teste, noutro script) NÃO pode disparar o relatório
const ehEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (process.argv.includes('--autoteste')) process.exit(autoteste());
if (!ehEntrypoint) { /* importado como módulo: nada a imprimir */ } else {

const alvo = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const slugs = (alvo.length ? alvo : (fs.existsSync(ATAS) ? fs.readdirSync(ATAS) : []))
  .filter((s) => fs.existsSync(path.join(ATAS, s)) && fs.statSync(path.join(ATAS, s)).isDirectory());

let total = 0;
const candidatas = [];
for (const slug of slugs) {
  for (const f of fs.readdirSync(path.join(ATAS, slug)).filter((x) => x.endsWith('.md'))) {
    total++;
    const r = analisar(fs.readFileSync(path.join(ATAS, slug, f), 'utf8'));
    if (r.suspeita && !r.jaRecuperada) candidatas.push({ slug, f, motivo: r.motivo, trechos: r.secos.slice(0, 2) });
  }
}

console.log(`${total} ata(s) analisadas — ${candidatas.length} candidata(s) a ter conteúdo em imagem:\n`);
for (const c of candidatas) {
  console.log(`  ${c.slug}/${c.f}  — ${c.motivo}`);
  for (const s of c.trechos) console.log(`      "${s.frase}"`);
}
console.log(candidatas.length
  ? '\nBaixe o PDF destas e rode: python scripts/ocr_imagens_ata.py <pdf> --ocr'
  : '\nNenhuma candidata — nada a recuperar por OCR.');
}
