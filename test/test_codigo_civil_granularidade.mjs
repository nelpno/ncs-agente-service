// test_codigo_civil_granularidade.mjs — Pesquisa 2 (feedback Fernando 24/07, vídeo ajustecodigocivil):
// a notificação pelo Código Civil citava o Art. 1.336 INTEIRO (deveres + fachada + juros/débito + multa),
// afogando o que interessa. Agora o retriever devolve o INCISO/PARÁGRAFO específico da conduta:
// barulho → Art. 1.336, IV (prejudicial ao sossego), SEM juros/fachada; inadimplência → § 1º (juros/débito).
// Determinístico e hermético: lê a base real, sem rede/segredo (roda no gate com env -i).
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buscarArtigoCC, consultar_codigo_civil } from "../src/codigo_civil.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = fs.readFileSync(path.join(__dirname, "..", "data", "codigo-civil", "codigo-civil.md"), "utf8");

let ok = 0, total = 0;
const check = (c, m) => { total++; assert(c, m); ok++; };

// ── 1) barulho → Art. 1.336, IV (sossego), e NÃO arrasta fachada/juros/débito ──
// Relato REAL do vídeo do Fernando (24/07): tem "em prejuízo ao sossego" — a palavra "prejuízo" NÃO pode
// desviar p/ o artigo de dano material (1.319); o inciso do sossego tem que vir em 1º.
{
  const relatoReal = "Em 23/07/2026, foi registrada ocorrência de excesso de barulho envolvendo a unidade 0203 BL 01 em relação à unidade 0202 BL 01, em prejuízo ao sossego entre unidades.";
  const r = buscarArtigoCC({ tema: relatoReal, k: 3 });
  check(r.encontrou, "buscarArtigoCC deveria achar artigo p/ barulho");
  const top = r.artigos[0];
  check(/Art\.\s*1\.336,\s*IV/.test(top.fundamento), `barulho: o TOPO deve ser o inciso do sossego (1.336, IV), não dano/1.319 — veio "${top.fundamento}"`);
  check(/sossego/i.test(top.texto), "texto do inciso IV deve falar de sossego");
  check(!/juros|débito|moratóri/i.test(top.texto), `o inciso IV NÃO pode arrastar juros/débito — veio: ${top.texto}`);
  check(!/cor da fachada/i.test(top.texto), `o inciso IV NÃO pode arrastar fachada — veio: ${top.texto}`);
  // verbatim: o texto citado tem que ser um recorte LITERAL da base (nunca do LLM)
  check(BASE.includes("não as utilizar de maneira prejudicial ao sossego, salubridade e segurança dos possuidores"),
    "sanity: a base tem o trecho literal do inciso IV");
  check(top.texto.includes("prejudicial ao sossego, salubridade e segurança dos possuidores"),
    "o texto do inciso IV deve ser VERBATIM da base");
}

// ── 2) inadimplência → Art. 1.336, § 1º (juros/multa/débito), SEM sossego ──
{
  const r = buscarArtigoCC({ tema: "condômino não paga a contribuição, juros e multa por atraso no débito", k: 3 });
  check(r.encontrou, "buscarArtigoCC deveria achar artigo p/ inadimplência");
  const top = r.artigos[0];
  check(/Art\.\s*1\.336,\s*§\s*1º/.test(top.fundamento), `topo deveria ser Art. 1.336, § 1º — veio "${top.fundamento}"`);
  check(/juros|débito/i.test(top.texto), "texto do § 1º deve falar de juros/débito");
  check(!/sossego/i.test(top.texto), `o § 1º NÃO pode arrastar sossego — veio: ${top.texto}`);
}

// ── 3) artigo SEM incisos (1.344 terraço/danos) continua INTEIRO e verbatim ──
{
  const r = buscarArtigoCC({ tema: "dano à unidade inferior por causa do terraço de cobertura", k: 3 });
  check(r.encontrou, "deveria achar 1.344");
  const t = r.artigos.find((a) => /1\.344/.test(a.fundamento));
  check(t, "1.344 deveria estar entre os candidatos p/ dano no terraço");
  check(/Art\.\s*1\.344$/.test(t.fundamento), `1.344 sem inciso: fundamento deveria terminar em "Art. 1.344" — veio "${t.fundamento}"`);
  check(t.texto.includes("unidades imobiliárias inferiores"), "texto de 1.344 verbatim");
}

// ── 4) a CONSULTA ainda acha o ARTIGO por número (não quebra o contrato do test_codigo_civil) ──
{
  const r = consultar_codigo_civil({ tema: "morador com som alto de madrugada perturbando o sossego" });
  const nums = (r.artigos || []).map((a) => (a.fonte.match(/Art\.\s*(1\.\d+)/) || [])[1]);
  check(nums.includes("1.336"), `consulta de barulho deveria achar 1.336 — veio [${nums}]`);
}

// ── 5) documentação interna (_LEIA.md) NUNCA entra como se fosse lei (anti-alucinação) ──
{
  for (const tema of ["deveres do condômino", "barulho", "multa por descumprimento", "obras na fachada"]) {
    const r = buscarArtigoCC({ tema, k: 5 });
    for (const a of (r.artigos || [])) {
      check(!/```|<texto|verbatim>|classifica o tópico|cabeça do modelo/i.test(a.texto),
        `texto contaminado por doc interno (_LEIA.md) no tema "${tema}": ${a.texto}`);
    }
  }
}

console.log(`test_codigo_civil_granularidade: ${ok}/${total} OK`);
