// test_allure_cap_xv.mjs — determinístico, sem LLM, sem rede.
// Guarda a lacuna real (23/07): o catálogo do Allure não tinha infração para o Capítulo XV
// (Indenização por Danos), então um pedido de notificação de INFILTRAÇÃO saía citando o capítulo
// de RUÍDO DE OBRA (base legal errada num documento que o síndico assina). O extrator SOBRESCREVE
// o JSON a cada re-extração e ainda não emite cláusulas de indenização → sem este guard, uma
// re-extração dropa o Cap XV de novo em silêncio. (Fix sistêmico = ensinar o extrator; até lá, isto.)
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DADOS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "gerador", "dados");
let ok = 0, total = 0;
const check = (c, m) => { total++; assert(c, m); ok++; };

const d = JSON.parse(fs.readFileSync(path.join(DADOS, "allure.json"), "utf8"));
const infras = Object.values(d.catalogo_infracoes || {});

// Cobre dano/infiltração? (fundamento no Cap XV OU palavra-chave de infiltração/dano)
const cobreDano = infras.some((i) =>
  /cap[íi]tulo\s+xv/i.test(i.fundamento || "") ||
  (Array.isArray(i.palavras_chave) && i.palavras_chave.some((k) => /infiltra|vazament|indeniza|dano/i.test(k))));
check(cobreDano, "catálogo do Allure precisa cobrir dano/infiltração (Cap XV) — senão a infiltração cita o capítulo errado");

// O artigo do Cap XV tem de ser o TEXTO LITERAL do regimento (verbatim), não paráfrase.
const capXV = infras.find((i) => /cap[íi]tulo\s+xv/i.test(i.fundamento || ""));
check(!!capXV, "deve existir uma infração fundamentada no Capítulo XV");
check(/indeniza|inteiramente indenizado/i.test(capXV.texto_artigo || ""), "texto do Cap XV deve conter o dever de indenizar (verbatim do regimento)");

console.log(`test_allure_cap_xv: ${ok}/${total} OK`);
