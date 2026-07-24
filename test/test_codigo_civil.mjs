// test_codigo_civil.mjs — determinístico, sem rede (lê data/codigo-civil/codigo-civil.md real).
// Pesquisa 2 (decisão Fernando 23/07): quando o RI/convenção não cobre, cita o Código Civil. Este teste
// garante que o retriever acha o ARTIGO CERTO por tema — a ponte de vocabulário (relato da equipe × texto da lei).
import assert from "node:assert";
import { consultar_codigo_civil } from "../src/codigo_civil.mjs";

let ok = 0, total = 0;
const check = (c, m) => { total++; assert(c, m); ok++; };
const arts = (r) => (r.artigos || []).map((a) => (a.fonte.match(/Art\. (1\.\d+)/) || [])[1]).filter(Boolean);
const acha = (tema, esperados, msg) => {
  const r = consultar_codigo_civil({ tema });
  check(r.encontrou, `"${tema}" deveria achar algo`);
  const got = arts(r);
  check(esperados.some((e) => got.includes(e)), `${msg}: esperava um de [${esperados}], veio [${got}]`);
};

// Infiltração / dano a outra unidade → 1.336 (IV: prejudicial à salubridade/segurança), 1.344 (terraço/danos
// às unidades inferiores) ou 1.319 (responde pelo dano que causou).
acha("infiltração vinda do apartamento de cima danificou o banheiro do vizinho de baixo", ["1.336", "1.344", "1.319"], "infiltração/dano");
acha("vazamento causou dano à unidade inferior", ["1.336", "1.344", "1.319"], "vazamento/dano");

// Barulho / perturbação do sossego → 1.336 (IV: prejudicial ao sossego).
acha("morador com som alto de madrugada perturbando o sossego dos vizinhos", ["1.336"], "barulho/sossego");

// Multa por descumprir deveres / reincidência → 1.336 (§2º) ou 1.337 (antissocial).
acha("condômino descumpre os deveres reiteradamente e será multado", ["1.337", "1.336"], "reincidência/multa");

// Inadimplência / contribuição / juros e multa moratória → 1.336 (§1º).
acha("condômino não paga a contribuição do condomínio, juros e multa por atraso", ["1.336"], "inadimplência");

// Obra que compromete a segurança / fachada → 1.336 (II/III) ou 1.341 (obras).
acha("obra que compromete a segurança da edificação", ["1.336", "1.341"], "obra/segurança");
acha("alteração da cor da fachada do prédio", ["1.336"], "fachada");

// Anti-alucinação: tema fora do escopo / vazio → não força artigo.
{
  const r = consultar_codigo_civil({ tema: "" });
  check(!r.encontrou, "tema vazio → encontrou:false");
}

console.log(`test_codigo_civil: ${ok}/${total} OK`);
