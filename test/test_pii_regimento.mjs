// test_pii_regimento.mjs — a CÓPIA QUE CONVERSA não devolve CPF/RG; a que GERA MULTA fica intacta.
//
// Decisão do Fernando (WhatsApp 09/08/2026, opção 2 de 3 que ofereci): "apagar o CPF só na cópia que
// a Ana usa para conversar, e manter o texto original inteiro na parte que gera multa". Convenção e
// Regimento são documentos REGISTRADOS e o gerador cita o texto deles palavra por palavra — mexer no
// texto que vai ao documento mudaria a base legal do que o síndico assina.
//
// Medido em 09/08 antes de implementar: 15 dos 122 .md têm CPF de dígito verificador válido,
// 27 ocorrências, 14 condomínios (atlanta 5, magnolias 4, reserva-do-campo 2, salto-grande-iii 2,
// spazio-aracaju 2, studio-five 2, tivoli 2, vistas-botanico-cedros 2, e 6 com 1 cada).
//
// 🔑 Por que mascarar na SAÍDA do retriever e não no arquivo: o `extrair-catalogo.mjs` lê o .md para
// montar o catálogo da multa. Mascarar o arquivo faria uma re-extração futura levar "[removido]"
// para dentro do `texto_artigo` — ou seja, para dentro do documento assinado — meses depois, em
// silêncio. Com a máscara na saída isso é impossível por construção.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mascararDocumentos, mascararPII, cpfValido } from '../src/pii_ata.mjs';
import { consultar_regimento } from '../src/regimento.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FALHA'} ${m}`); if (!c) falhas++; };

// Detector independente do mascarador de propósito: se ele reimplementasse a regra, os dois
// derivariam e o teste aprovaria o vazamento (foi o que aconteceu com as atas em 09/08).
// Este aqui é GANANCIOSO — pega qualquer sequência com cara de CPF e confere o dígito.
const RE_CPF = new RegExp('[0-9]{3}[.,\\s-]?[0-9]{3}[.,\\s-]?[0-9]{3}[.,\\s-]?[0-9]{2}', 'g');
const achaCpf = (t) => (String(t).match(RE_CPF) || []).filter((m) => cpfValido(m));

// ── 1. o que PRECISA sair: trecho real do regimento do Monet ──────────────────
const real = 'Este Regimento Interno entrará em vigor na data da aprovação '
  + 'Alexandre Augusto Scalise CPF 138.891.978-84 Síndico';
const lim = mascararDocumentos(real);
ok(!/138\.891\.978-84/.test(lim), 'o CPF do síndico sai do trecho');
ok(/\[removido\]/.test(lim), 'fica a marca de que havia um dado ali');

// ── 2. o que NÃO PODE sair: o nome ────────────────────────────────────────────
// Diferença deliberada em relação à ata. Na ata o Fernando mandou tirar o nome também; aqui não:
// o time usa o trecho para redigir, e "o síndico é X" é informação legítima e pública do
// condomínio. Tirar o nome quebraria a citação sem proteger nada que ele tenha pedido.
ok(/Alexandre Augusto Scalise/.test(lim), 'o NOME do síndico permanece (só o número sai)');
ok(/Síndico/.test(lim), 'o cargo permanece');
ok(/entrará em vigor na data da aprovação/.test(lim), 'o texto da regra fica intacto');

// ── 3. RG na qualificação do incorporador (Convenção do Atlanta) ──────────────
const atl = 'casado, economista, portador do RG no. MG 6278360 SSP- MG, inscrito no CPF/MF '
  + 'sob no. 002.279.686-03, com endereço';
const latl = mascararDocumentos(atl);
ok(!/002\.279\.686-03/.test(latl), 'CPF na qualificação sai');
ok(!/6278360/.test(latl), 'RG na qualificação sai');
ok(/economista/.test(latl), 'a qualificação civil permanece');

// ── 4. texto limpo sai BYTE-IDÊNTICO ──────────────────────────────────────────
// Sem isso a máscara poderia estar reescrevendo 122 arquivos de regra e ninguém veria.
const limpo = 'Art. 15 — É vedado o uso de churrasqueira fora do horário das 10h às 22h, '
  + 'sob pena de multa de 2% (dois por cento) sobre a taxa condominial, conforme o Art. 1.336 § 2º.';
ok(mascararDocumentos(limpo) === limpo, 'trecho de regra sem PII volta byte-idêntico');

// ── 5. número que NÃO é documento não pode ser tocado ─────────────────────────
const numeros = 'A taxa é de R$ 1.234.567,89 e o artigo 1.336 do Código Civil, item 4.2.1.3, '
  + 'aprovado por 123.456.789 votos.';
ok(mascararDocumentos(numeros) === numeros, 'valor, artigo e numeração não são confundidos com CPF');

// ── 6. a ata NÃO regride: lá o nome continua saindo ───────────────────────────
// mascararPII e mascararDocumentos compartilham os MESMOS padrões de documento — se alguém separar
// as duas regras, este teste acusa antes de o vazamento chegar às 219 atas.
const ata = 'presidida pelo Sr. ANGELO RODRIGUES GOLDONI, portador do CPF sob n.º 075.992.948-30';
const lata = mascararPII(ata);
ok(!/075\.992\.948-30/.test(lata), 'ata: CPF continua saindo');
ok(!/ANGELO RODRIGUES GOLDONI/.test(lata), 'ata: o nome continua saindo (regra diferente da do regimento)');

// ── 7. FIM A FIM: o retriever não devolve CPF em nenhum dos 14 afetados ───────
const AFETADOS = ['atlanta', 'magnolias', 'reserva-do-campo', 'salto-grande-iii', 'spazio-aracaju',
  'studio-five', 'tivoli', 'vistas-botanico-cedros', 'lharmonie', 'monet', 'moove',
  'pracas-do-sol', 'riacho-doce', 'vitta-pairas'];
const ATAQUE = ['qual o CPF do síndico', 'quem assina a convenção e qual o documento dele',
  'qual o RG do incorporador', 'quem aprovou o regimento interno'];
let vazou = 0, consultas = 0, trechos = 0;
for (const slug of AFETADOS) {
  for (const q of ATAQUE) {
    let r; try { r = await consultar_regimento({ condominio: slug, pergunta: q }); } catch { continue; }
    consultas++;
    for (const t of (r.trechos || [])) { trechos++; if (achaCpf(t.texto).length) vazou++; }
  }
}
ok(consultas > 40, `o ataque realmente rodou (${consultas} consultas, ${trechos} trechos)`);
ok(vazou === 0, `nenhum trecho devolvido contém CPF válido (vazaram: ${vazou})`);

// ── 8. CONTROLE POSITIVO: o detector do teste funciona ────────────────────────
// Sem isto o item 7 passaria mesmo com a máscara desligada e o detector quebrado — "0 encontrado"
// é indistinguível de "não procurei". Já me custou uma conclusão errada entregue ao usuário.
ok(achaCpf('inscrito no CPF/MF sob no. 002.279.686-03,').length === 1, 'o detector ACHA um CPF real');
ok(achaCpf('o artigo 1.336 e a taxa de R$ 1.234.567,89').length === 0, 'o detector NÃO acha onde não há');

// ── 9. o lado da MULTA fica intacto ───────────────────────────────────────────
// É esta a metade da decisão do Fernando que ninguém testaria: se um dia alguém mascarar o .md e
// re-extrair, o "[removido]" entra no texto_artigo e sai impresso na multa. O gate pega aqui.
const dadosDir = path.join(RAIZ, 'gerador/dados');
const catalogos = fs.readdirSync(dadosDir).filter((f) => f.endsWith('.json'));
let sujos = [];
for (const f of catalogos) {
  const bruto = fs.readFileSync(path.join(dadosDir, f), 'utf8');
  if (/\[removido\]|\[nome removido\]/.test(bruto)) sujos.push(f);
}
ok(catalogos.length > 40, `catálogos de multa encontrados (${catalogos.length})`);
ok(sujos.length === 0, `nenhum catálogo tem marca de máscara — o texto que vira multa está íntegro${sujos.length ? ' (sujos: ' + sujos.join(', ') + ')' : ''}`);

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OK');
assert.equal(falhas, 0, `test_pii_regimento: ${falhas} falha(s)`);
