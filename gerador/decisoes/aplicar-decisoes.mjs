// aplicar-decisoes.mjs — aplica as DECISOES HUMANAS de citacao (decisoes-citacao.json) sobre os catalogos.
//
// Por que existe: extrair-catalogo.mjs reescreve texto_artigo/fundamento a cada re-extracao e APAGARIA a
// resposta que o Fernando deu sobre qual trecho do RI/Convencao fundamenta cada infracao. As decisoes ficam
// num arquivo versionado e este script as re-aplica. Rodar SEMPRE depois de re-extrair um catalogo tocado.
//
// Contrato (o mesmo do tighten-artigo): a saida e composta de blocos LITERAIS da fonte, unidos por "(...)".
// NUNCA digitamos o texto do artigo - localizamos na fonte ingerida e recortamos. Se nao localizar, ABORTA
// aquele caso e reporta (nunca grava um texto que nao esteja provado na fonte).
//
//   node aplicar-decisoes.mjs           -> DRY-RUN: mostra antes/depois, nao grava
//   node aplicar-decisoes.mjs APPLY=1   -> grava nos catalogos (vendor + fonte)
//
// Depois de aplicar: node verificar-catalogo.mjs  (prova verbatim, sem LLM)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// raiz derivada do ARQUIVO (nao do cwd): rodar de outra pasta nao pode mudar o alvo.
// Este arquivo vive em agente-service/gerador/decisoes/ -> SERVICO = agente-service.
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SERVICO = path.resolve(AQUI, "..", "..");
const VENDOR = path.join(SERVICO, "gerador/dados");
// copia-fonte fora do git (automacoes/gerador-documentos/dados) - atualizada junto quando existe,
// para os dois nao divergirem. O VENDOR e a verdade (e o que builda na imagem).
const FONTE_DADOS = path.resolve(SERVICO, "..", "gerador-documentos", "dados");
const REGIMENTOS = path.join(SERVICO, "data/regimentos");

const { localizarArtigos, localizarItem } = await import(
  path.join(SERVICO, "gerador/src/fundamento.mjs").replace(/\\/g, "/").replace(/^([A-Za-z]):/, "file:///$1:")
);

const APPLY = process.argv.includes("APPLY=1") || process.env.APPLY === "1";
const collapse = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// Prova de verbatim: o caput devolvido por localizarArtigos JA vem normalizado de proposito
// ("ARTIGO 14°\n: É vedado…" -> "ARTIGO 14°: É vedado…", porque o espaco antes do ":" e da quebra de
// linha da fonte). Comparar cru reprovaria um recorte CORRETO -> comparo pela mesma normalizacao.
const provaNorm = (s) => collapse(s).replace(/\s+:/g, ":").replace(/:\s*:/g, ":").toLowerCase();

// Cabecalho de artigo/capitulo que aparece NA MESMA LINHA do item (a fonte nem sempre quebra linha).
// Sem isto o ultimo item de uma lista engole o artigo seguinte - citacao com artigo alheio colado,
// que e pior que a citacao ampla que estamos consertando (era o caso do spazio-abbocato item k).
const RE_CAB_INLINE = /(?:^|[\s;.])((?:ARTIGOS?|Art(?:igos?)?)\.?\s*\d{1,3}\s*[º°oa]?\s*[-–.:]|CAP[ÍI]TULO\s|SE[ÇC][ÃA]O\s)/i;
function cortarNoProximoCabecalho(texto) {
  // ignora um cabecalho logo no inicio (o proprio item pode comecar citando "Art.")
  const m = texto.slice(12).match(RE_CAB_INLINE);
  if (!m) return texto;
  return collapse(texto.slice(0, 12 + m.index + (/^[\s;.]/.test(m[0]) ? 1 : 0)));
}

function carregarFonte(slug, preferida) {
  const dir = path.join(REGIMENTOS, slug);
  if (!fs.existsSync(dir)) return null;
  const arqs = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  // "regimento" -> regimento-interno-*.md ; "convencao" -> convencao-*.md (estatuto conta como convencao)
  const filtro = preferida === "convencao" ? /^(convencao|estatuto)/i : /^regimento/i;
  const escolhidos = arqs.filter((f) => filtro.test(f));
  if (!escolhidos.length) return null;
  return escolhidos.map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n\n");
}

// Tipo do marcador do item. ⚠️ ARMADILHA: "i", "v" e "x" sao letras de lista alfabetica E numerais
// romanos. Classificar "v" como romano faz o corte procurar o proximo item ROMANO - que nao existe -
// e o item engole todo o resto do artigo (era o caso vancouver item v), que vinha com o w) e os
// PARAGRAFOS colados). Uma letra sozinha e SEMPRE letra; romano exige 2+ caracteres em maiusculo.
// O JSON pode declarar `tipo_item` explicitamente e isso vence a inferencia.
function tipoDoItem(it, declarado) {
  if (declarado) return declarado;
  if (/^§/.test(it)) return "paragrafo";
  if (/^\d+\.\d+$/.test(it)) return "dec";
  if (/^[IVX]{2,}$/.test(it)) return "romano";
  return "letra";
}

const dec = JSON.parse(fs.readFileSync(path.join(AQUI, "decisoes-citacao.json"), "utf8"));
const resultados = [];

for (const d of dec.decisoes) {
  const r = { ...d, ok: false, motivo: "", antes: "", depois: "" };
  const fonte = carregarFonte(d.slug, d.fonte);
  if (!fonte) { r.motivo = `fonte '${d.fonte}' nao encontrada em data/regimentos/${d.slug}`; resultados.push(r); continue; }

  const arqVendor = path.join(VENDOR, d.slug + ".json");
  if (!fs.existsSync(arqVendor)) { r.motivo = "catalogo do vendor nao existe"; resultados.push(r); continue; }
  const cat = JSON.parse(fs.readFileSync(arqVendor, "utf8"));
  const inf = (cat.catalogo_infracoes || {})[d.id];
  if (!inf) { r.motivo = `infracao '${d.id}' nao existe no catalogo`; resultados.push(r); continue; }
  r.antes = inf.texto_artigo || "";

  // §N do Atlanta: o proprio "§1" e localizavel como cabecalho -> trato como artigo dentro do bloco
  const primeiro = d.itens[0];
  const tipo = tipoDoItem(primeiro, d.tipo_item);

  const { escolhido } = localizarArtigos(fonte, d.artigo, {
    item: tipo === "paragrafo" ? null : primeiro,
    tipoItem: tipo === "paragrafo" ? null : tipo,
  });
  if (!escolhido) { r.motivo = `artigo '${d.artigo}' nao localizado na fonte`; resultados.push(r); continue; }

  const bloco = fonte.slice(escolhido.ini, escolhido.fim);
  const partes = [];
  const caput = collapse(escolhido.caput);

  // ÂNCORA DE TEXTO: para regra que existe na fonte mas NÃO tem marcador de item (a lista do
  // Art. 10 do salto-grande-i é uma sequência de frases soltas, sem letras). O fatiador não acha
  // e o texto_artigo ficava VAZIO — o documento saía citando o artigo sem transcrever a regra.
  // Recorta VERBATIM da âncora até o fim da frase (ponto-e-vírgula ou ponto final).
  if (d.ancora) {
    const iAnc = bloco.toLowerCase().indexOf(String(d.ancora).toLowerCase());
    if (iAnc < 0) { r.motivo = `ancora "${d.ancora}" nao localizada no bloco do artigo`; resultados.push(r); continue; }
    const resto = bloco.slice(iAnc);
    const mFim = resto.match(/[;.](?=\s|$)/);
    const trecho = collapse(resto.slice(0, mFim ? mFim.index + 1 : Math.min(resto.length, 400)));
    // Caput CURTO: quando a lista não tem marcador de item, localizarArtigos não sabe onde o caput
    // termina e arrasta os primeiros itens junto — no salto-grande-i isso trouxe o trecho que o OCR
    // embaralhou ("promover a prática de ou quaisquer deixar promover..."). Corto no ":" de
    // "É PROIBIDO:", que é onde o caput realmente acaba.
    const mDoisPontos = caput.match(/^[\s\S]{0,120}?:/);
    const caputCurto = mDoisPontos ? collapse(mDoisPontos[0]) : caput;
    partes.push(caputCurto, trecho);
    const nf0 = provaNorm(fonte);
    if (!partes.every((p) => nf0.includes(provaNorm(p)))) {
      r.motivo = 'bloco da ancora nao confere verbatim na fonte'; resultados.push(r); continue;
    }
    const novoTxt = partes.join('\n\n(...)\n\n');
    r.depois = novoTxt; r.ok = true;
    r.motivo = collapse(r.antes) === collapse(novoTxt) ? 'ja estava correto (idempotente)' : 'recortado por ancora';
    if (APPLY) {
      for (const base of [VENDOR, FONTE_DADOS]) {
        const arq = path.join(base, d.slug + '.json');
        if (!fs.existsSync(arq)) continue;
        const c = JSON.parse(fs.readFileSync(arq, 'utf8'));
        const i2 = (c.catalogo_infracoes || {})[d.id];
        if (!i2) continue;
        i2.texto_artigo = novoTxt;
        if (d.fundamento) i2.fundamento = d.fundamento;
        delete i2.revisar;                       // o motivo do "revisar" (bloco vazio) deixou de existir
        i2.decisao_humana = { por: 'Nelson (recuperado da fonte)', em: '2026-08-04', nota: d.nota || '' };
        fs.writeFileSync(arq, JSON.stringify(c, null, 1) + '\n', 'utf8');
        r.gravado = (r.gravado || []).concat(path.basename(base));
      }
    }
    resultados.push(r); continue;
  }

  if (tipo === "paragrafo") {
    // O bloco do artigo TERMINA no proximo "§" (localizarArtigos corta ali), entao o §1 fica FORA dele.
    // Busco a partir do INICIO do artigo na fonte inteira, limitado ao proximo artigo/capitulo.
    const num = primeiro.replace(/[^\d]/g, "");
    const depoisDoArtigo = fonte.slice(escolhido.ini);
    const re = new RegExp(`§\\s*${num}\\s*[º°oa]?`, "i");
    const m = depoisDoArtigo.match(re);
    if (!m) { r.motivo = `paragrafo '${primeiro}' nao localizado apos o artigo '${d.artigo}'`; resultados.push(r); continue; }
    // o § tem de pertencer a ESTE artigo: nao pode haver outro cabecalho de artigo entre os dois
    const entre = depoisDoArtigo.slice(escolhido.fim - escolhido.ini, m.index);
    if (/(?:^|\n)[ \t]*#{0,4}[ \t]*\**\s*(?:CAP[ÍI]TULO|SE[ÇC][ÃA]O|(?:ARTIGOS?|Art(?:igos?)?)\.?\s*\d)/i.test(entre)) {
      r.motivo = `paragrafo '${primeiro}' pertence a outro artigo (ha cabecalho entre eles)`;
      resultados.push(r); continue;
    }
    const resto = depoisDoArtigo.slice(m.index + m[0].length);
    const mFim = resto.match(/(?:^|\n)[ \t]*#{0,4}[ \t]*\**\s*(?:CAP[ÍI]TULO|SE[ÇC][ÃA]O|(?:ARTIGOS?|Art(?:igos?)?)\.?\s*\d|§\s*\d)/i);
    const texto = collapse(depoisDoArtigo.slice(m.index, m.index + m[0].length + (mFim ? mFim.index : resto.length)));
    partes.push(caput, texto);
  } else {
    for (const it of d.itens) {
      const achado = localizarItem(bloco, it, tipo);
      if (!achado) { r.motivo = `item '${it}' nao localizado no bloco do artigo '${d.artigo}'`; break; }
      partes.push(cortarNoProximoCabecalho(achado.texto));
    }
    if (r.motivo) { resultados.push(r); continue; }
    partes.unshift(caput);
  }

  const novo = partes.filter(Boolean).join("\n\n(...)\n\n");

  // PROVA: cada bloco literal tem de existir na fonte. Sem isso nao grava.
  const nfonte = provaNorm(fonte);
  const faltando = partes.filter((p) => !nfonte.includes(provaNorm(p)));
  if (faltando.length) {
    r.motivo = `bloco nao confere verbatim na fonte (${faltando.length}): "${collapse(faltando[0]).slice(0, 60)}..."`;
    resultados.push(r); continue;
  }

  r.depois = novo;
  r.ok = true;
  r.motivo = collapse(r.antes) === collapse(novo) ? "ja estava correto (idempotente)" : "recortado";

  if (APPLY) {
    for (const base of [VENDOR, FONTE_DADOS]) {
      const arq = path.join(base, d.slug + ".json");
      if (!fs.existsSync(arq)) continue;
      const c = JSON.parse(fs.readFileSync(arq, "utf8"));
      const i = (c.catalogo_infracoes || {})[d.id];
      if (!i) continue;
      i.texto_artigo = novo;
      if (d.fundamento) i.fundamento = d.fundamento;
      i.decisao_humana = { por: "Fernando (diretor)", em: "2026-08-04", nota: d.nota || "" };
      fs.writeFileSync(arq, JSON.stringify(c, null, 1) + "\n", "utf8");
      r.gravado = (r.gravado || []).concat(path.basename(base));
    }
  }
  resultados.push(r);
}

// ---------- relatorio (impresso ANTES de qualquer gravacao de arquivo auxiliar) ----------
console.log("=".repeat(78));
console.log(APPLY ? "APLICANDO (APPLY=1)" : "DRY-RUN (nada gravado) - use APPLY=1 para gravar");
console.log("=".repeat(78));
for (const r of resultados) {
  const tag = r.ok ? (r.motivo === "ja estava correto (idempotente)" ? "= IGUAL" : "+ OK   ") : "! FALHA";
  console.log(`\n${tag} ${r.slug}/${r.id}`);
  if (!r.ok) { console.log(`        motivo: ${r.motivo}`); continue; }
  console.log(`        antes  (${collapse(r.antes).length}c): ${collapse(r.antes).slice(0, 150)}`);
  console.log(`        depois (${collapse(r.depois).length}c): ${collapse(r.depois).slice(0, 220)}`);
  if (r.gravado) console.log(`        gravado em: ${r.gravado.join(", ")}`);
}
const ok = resultados.filter((r) => r.ok).length;
const falhas = resultados.filter((r) => !r.ok);
console.log("\n" + "=".repeat(78));
console.log(`VEREDITO: ${ok}/${resultados.length} aplicaveis | falhas: ${falhas.length}`);
for (const f of falhas) console.log(`  FALHA ${f.slug}/${f.id}: ${f.motivo}`);
process.exit(falhas.length ? 1 : 0);
