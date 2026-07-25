// test_fundamento.mjs — leitura do campo `fundamento` do catálogo (a base legal que o documento IMPRIME) e
// localização do artigo/item na fonte. É o que permite alinhar o texto citado ao fundamento quando os dois
// discordam — caso real: o barulho do Vancouver citava "ARTIGO 14°: i)" e imprimia o item c) (persianas), e
// a multa não saía porque o verificador de enquadramento recusava, corretamente.
//
// Formatos cobertos são os REAIS do corpus (623 infrações, 52 condomínios). Fixtures próprias: nenhum teste
// aqui depende de catálogo de produção.
import assert from "node:assert";
import { parseFundamento, localizarArtigo, localizarArtigos, localizarItem } from "../gerador/src/fundamento.mjs";

let ok = 0, total = 0;
const falhas = [];
const check = (c, m) => { total++; if (c) ok++; else falhas.push(m); };
const eq = (a, b, m) => check(a === b, `${m} — esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);

// ── 1) parse dos formatos reais ──
{
  const p = (fd) => parseFundamento(fd);
  eq(p("ARTIGO 14°: i)").artigo, "ARTIGO 14", "artigo com ordinal e item por letra");
  eq(p("ARTIGO 14°: i)").item, "i", "item por letra");
  eq(p("Regimento Interno, Parágrafo 6º, k)").artigo, "Parágrafo 6", "parágrafo (o documento é só contexto)");
  eq(p("Regimento Interno, Parágrafo 6º, k)").item, "k", "item do parágrafo");
  eq(p("Artigo 4° - Parágrafo Segundo, item e)").item, "e", "'item e)' com a palavra item");
  eq(p("Capítulo VIII - Do Horário Art. 3º").artigo, "Art. 3", "a ÚLTIMA referência é a que localiza (não o capítulo)");
  eq(p("Capítulo VIII - Do Horário Art. 3º").item, null, "sem item");
  eq(p("12.6").item, "12.6", "decimal é o ITEM, não o artigo");
  eq(p("12.6").artigo, null, "decimal sozinho não vira artigo");
  eq(p("Art. 8° - I").item, "I", "romano");
  eq(p("ARTIGO 51° - A)= DAS PROIBIÇÕES AOS CONDÔMINOS: 4)").item, "4", "item numérico");
  eq(p("Art. 22°").artigo, "Art. 22", "só artigo: o corte do item não pode comer o número (bug real)");
  eq(p("Art. 22°").item, null, "só artigo → sem item");
  eq(p("").artigo, null, "vazio");
  eq(p(null).item, null, "null não explode");
}

// ── 2) localizar o artigo e o item na fonte ──
{
  const fonte = [
    "## CAPITULO IV",
    "### ARTIGO 14°",
    ": É vedado aos condôminos: a) Alugar qualquer apartamento para clubes de jogos;",
    "",
    "i) Usar aparelhagem de som, televisão, ou quaisquer outros instrumentos, mesmo musicais, de maneira a incomodar os demais condôminos, sendo vedado qualquer ruído entre as 22h00 e 08h00;",
    "",
    "j) Criar ou manter animais nas dependências;",
    "",
    "### ARTIGO 15°",
    ": Os condôminos responderão pelos danos causados.",
  ].join("\n");
  const loc = localizarArtigo(fonte, "ARTIGO 14", { item: "i", tipoItem: "letra" });
  check(!!loc, "artigo localizado");
  // ⚠️ o caput NÃO pode parar no ":" que vem logo após o número, senão perde o verbo que proíbe
  check(/vedado aos condôminos/.test(loc.caput), `caput sem o verbo: "${loc.caput}"`);
  check(/ARTIGO 14/.test(loc.caput), "caput traz o número do artigo (é o que a citação precisa)");
  check(!/Alugar qualquer apartamento/.test(loc.caput), `caput arrastou o 1º item: "${loc.caput}"`);
  const it = localizarItem(fonte.slice(loc.ini, loc.fim), "i", "letra");
  check(!!it && /aparelhagem de som/.test(it.texto), "item i) localizado");
  check(it && !/Criar ou manter animais/.test(it.texto), `o item engoliu o irmão: "${it && it.texto}"`);
  // o bloco do artigo termina no próximo cabeçalho
  check(!/ARTIGO 15/.test(fonte.slice(loc.ini, loc.fim)), "o bloco não invade o artigo seguinte");
}

// ── 3) o MESMO número existe no regimento E na convenção: a ocorrência certa é a que tem o item ──
{
  const regimento = "### ARTIGO 8°\n: Fica instituído o conselho fiscal, que se reunirá anualmente.\n";
  const convencao = "### ARTIGO 8°\n: São deveres dos condôminos: a) zelar pelas áreas comuns;\n\nn) Não manter animais ou aves nas respectivas unidades autônomas;\n";
  const fonte = regimento + "\n" + convencao;
  const { todos } = localizarArtigos(fonte, "ARTIGO 8", { item: "n", tipoItem: "letra" });
  eq(todos.length, 2, "as duas ocorrências são encontradas (o âmbito depende disso)");
  const loc = localizarArtigo(fonte, "ARTIGO 8", { item: "n", tipoItem: "letra" });
  check(/São deveres/.test(loc.caput), `escolheu a ocorrência SEM o item: "${loc.caput}"`);
  check(!!localizarItem(fonte.slice(loc.ini, loc.fim), "n", "letra"), "o item existe na ocorrência escolhida");
}

// ── 4) fail-safe: artigo inexistente e item inexistente não podem "achar de qualquer jeito" ──
{
  const fonte = "### ARTIGO 3°\n: É proibido fumar. a) nas áreas comuns;";
  eq(localizarArtigo(fonte, "ARTIGO 99"), null, "artigo que não existe → null");
  eq(localizarItem(fonte, "z", "letra"), null, "item que não existe → null");
  eq(localizarItem(fonte, null, "letra"), null, "item nulo → null");
}

if (falhas.length) { for (const f of falhas) console.error(`  ✗ ${f}`); assert.fail(`test_fundamento: ${falhas.length} de ${total} falharam`); }
console.log(`test_fundamento: ${ok}/${total} OK`);
