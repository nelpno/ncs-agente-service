// mascarar_atas.mjs — tira CPF/RG de TODA ata em data/atas/ antes de o lote ficar consultável.
//
// Por que é um passo separado da ingestão: as atas entram no repositório gravadas verbatim (é o
// que permite subagentes paralelos escreverem centenas de arquivos sem o texto passar pelo
// contexto de ninguém). O mascaramento roda por cima, é idempotente, e quem garante que ele foi
// executado é o guard de `test/test_atas_separacao.mjs` — teste vermelho = build sem imagem.
// Esquecer de rodar não vira vazamento silencioso; vira deploy bloqueado.
//
//   conferir : node scripts/mascarar_atas.mjs
//   aplicar  : APPLY=1 node scripts/mascarar_atas.mjs
//
// ⚠️ APPLY vem do AMBIENTE, não do argv: `node scripts/mascarar_atas.mjs APPLY=1` imprime DRY-RUN
// e não grava nada, com exit 0.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mascararPII, _temPII } from '../src/pii_ata.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ATAS = path.join(__dirname, '..', 'data', 'atas');
const APPLY = process.env.APPLY === '1';

if (!fs.existsSync(ATAS)) {
  console.log(`data/atas/ ainda não existe — nada a fazer.`);
  process.exit(0);
}

// TRANSACIONAL: computa tudo primeiro e só grava se TODOS os arquivos passarem no guard.
// ⚠️ A 1ª versão gravava dentro do laço e só falhava no fim — quando o guard pegou 2 arquivos, os
// outros 23 já estavam gravados com a regra da vez, e o lote ficou meio numa versão e meio na
// outra, sem nada na tela dizendo isso. Lote parcialmente aplicado é pior que lote não aplicado.
let total = 0;
const pendentes = [];   // { alvo, rotulo, depois, docs, nomes }
const problemas = [];

for (const slug of fs.readdirSync(ATAS).sort()) {
  const dir = path.join(ATAS, slug);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.md')) continue;
    total++;
    const alvo = path.join(dir, f);
    const antes = fs.readFileSync(alvo, 'utf8');
    const depois = mascararPII(antes);
    if (antes === depois) continue;
    if (_temPII(depois)) { problemas.push(`${slug}/${f}`); continue; }
    const conta = (s, re) => (s.match(re) || []).length;
    pendentes.push({
      alvo, rotulo: `${slug}/${f}`, depois,
      docs: conta(depois, /\[removido\]/g) - conta(antes, /\[removido\]/g),
      nomes: conta(depois, /\[nome removido\]/g) - conta(antes, /\[nome removido\]/g),
    });
  }
}

if (problemas.length) {
  console.log(`ERRO: ${problemas.length} arquivo(s) continuam com PII depois do mascaramento:`);
  for (const p of problemas) console.log(`  ${p}`);
  console.log(`\nNADA foi gravado (nem os ${pendentes.length} que passaram) — o lote é tudo ou nada.`);
  console.log('Conferir o padrão em src/pii_ata.mjs antes de seguir.');
  process.exit(1);
}

for (const p of pendentes) {
  console.log(`${APPLY ? 'GRAVADO ' : 'DRY-RUN '} ${p.rotulo} — ${p.docs} documento(s), ${p.nomes} nome(s) de mesa`);
  if (APPLY) fs.writeFileSync(p.alvo, p.depois, 'utf8');
}
console.log(`\n${APPLY ? 'APLICADO' : 'DRY-RUN (nada gravado)'} — ${total} ata(s) varrida(s), ${pendentes.length} com PII, ${total - pendentes.length} já limpas.`);
