// test_nome_condominio.mjs — resolver o condomínio pelo nome como a equipe DIGITA.
//
// Bug achado no smoke de 24/07: a equipe escreve "Condominio Vancouver" (é assim que se fala e é assim
// que o nome aparece nos documentos) e o Estagiário respondia *"o sistema continua sem a base necessária
// do Condomínio Vancouver"* — só "Vancouver" funcionava. Causa: o catálogo casava por igualdade exata e o
// ERP por substring, e "condominio vancouver" não é substring de "CONDOMINIO RESIDENCIAL VANCOUVER"
// (a palavra do meio atravessa).
//
// ⚠️ O afrouxamento não pode reabrir a colisão que já custou um condomínio quebrado em silêncio
// ("Cedros" × "Cedros do Campo" × "Vistas do Botânico - Cedros"): quando o nome digitado serve para mais
// de um condomínio, o certo é PERGUNTAR, nunca escolher. Fixtures próprias — não lê catálogo de produção.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tokensNome, casaPorTokens } from "../gerador/src/match-nome.mjs";
import { carregarCondominio } from "../gerador/src/gerar-lib.mjs";

let ok = 0, total = 0;
const falhas = [];
const check = (c, m) => { total++; if (c) ok++; else falhas.push(m); };

// ── fixtures: uma raiz temporária com 4 catálogos que reproduzem os nomes reais ──
const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "ncs-nome-"));
fs.mkdirSync(path.join(raiz, "dados"));
const grava = (slug, superlogica_nome, aliases = []) => fs.writeFileSync(
  path.join(raiz, "dados", `${slug}.json`),
  JSON.stringify({ id: slug, superlogica_nome, aliases, catalogo_infracoes: { x: { titulo: "T", texto_artigo: "t" } } }), "utf8");
grava("vancouver", "CONDOMINIO RESIDENCIAL VANCOUVER");
grava("sg-cedros-do-campo", "Cedros do Campo");
grava("vistas-botanico-cedros", "Vistas do Botânico - Cedros");
grava("park", "Residencial Park", ["Edifício Park"]);

// ── 1) o que já funcionava tem de continuar: slug e nome exato ──
{
  check(carregarCondominio("vancouver", raiz).id === "vancouver", "slug direto");
  check(carregarCondominio("CONDOMINIO RESIDENCIAL VANCOUVER", raiz).id === "vancouver", "nome do sistema exato");
  check(carregarCondominio("Residencial Park", raiz).id === "park", "superlogica_nome exato");
  check(carregarCondominio("Edifício Park", raiz).id === "park", "alias exato");
}

// ── 2) O BUG: prefixo/palavra do meio que a equipe digita ──
{
  for (const q of ["Condominio Vancouver", "condomínio vancouver", "Cond. Vancouver", "VANCOUVER", "Residencial Vancouver"]) {
    let id = null; try { id = carregarCondominio(q, raiz).id; } catch (e) { id = String(e.message).slice(0, 60); }
    check(id === "vancouver", `"${q}" deveria resolver p/ vancouver — veio ${id}`);
  }
  check(carregarCondominio("Condomínio Cedros do Campo", raiz).id === "sg-cedros-do-campo", "prefixo + nome de 3 palavras");
  check(carregarCondominio("Vistas do Botânico", raiz).id === "vistas-botanico-cedros", "nome parcial sem a palavra colidente");
}

// ── 3) COLISÃO: nome que serve a dois condomínios → erro que PEDE o nome completo, nunca escolhe ──
{
  let err = null;
  try { carregarCondominio("Cedros", raiz); } catch (e) { err = e.message; }
  check(!!err, `"Cedros" casa com 2 condomínios (Cedros do Campo e Vistas do Botânico - Cedros) → tem de recusar`);
  check(/2|dois|mais de um|Cedros do Campo/i.test(err || ""), `o erro tem de dizer quais são, p/ a pessoa escolher: ${err}`);
  // e "Condomínio" sozinho não resolve nada (é só palavra estrutural)
  let err2 = null;
  try { carregarCondominio("Condomínio", raiz); } catch (e) { err2 = e.message; }
  check(!!err2, "só a palavra 'Condomínio' não pode resolver um condomínio qualquer");
  let err3 = null;
  try { carregarCondominio("Xanadu", raiz); } catch (e) { err3 = e.message; }
  check(!!err3, "nome inexistente continua erro");
}

// ── 4) a função pura (usada também pelo resolvedor do ERP) ──
{
  check(tokensNome("Condomínio Residencial Vancouver").join(",") === "vancouver", `stopwords estruturais fora: ${tokensNome("Condomínio Residencial Vancouver")}`);
  check(tokensNome("Assoc. de Moradores do Lot Fechado Jd Res Piemonte").includes("piemonte"), "associação/loteamento também são estruturais");
  check(tokensNome("Condomínio").length === 0, "só estrutural → nenhum token significativo");
  check(casaPorTokens(["vancouver"], ["CONDOMINIO RESIDENCIAL VANCOUVER"]), "todas as palavras presentes → casa");
  check(!casaPorTokens(["vancouver", "sul"], ["CONDOMINIO RESIDENCIAL VANCOUVER"]), "palavra a mais que não existe → não casa");
  check(!casaPorTokens(["campo"], ["Vistas do Botânico - Cedros"]), "palavra ausente → não casa");
}

// ── 5) o resolvedor do ERP (Superlógica) tem de aceitar o MESMO jeito de digitar, senão o catálogo
//       resolve e o cadastro do condomínio não (o pedido morre no meio). `deps.condos` = sem rede/PII. ──
{
  const { resolver_condominio } = await import("../estagiario/src/superlogica.mjs");
  const condos = [
    { id_condominio_cond: 191, st_fantasia_cond: "VANCOUVER", st_nome_cond: "CONDOMINIO RESIDENCIAL VANCOUVER", st_endereco_cond: "R X", st_cidade_cond: "ARARAQUARA", st_uf_uf: "SP" },
    { id_condominio_cond: 175, st_fantasia_cond: "CEDROS", st_nome_cond: "CONDOMINIO CEDROS", st_endereco_cond: "R Y", st_cidade_cond: "ARARAQUARA", st_uf_uf: "SP" },
    { id_condominio_cond: 187, st_fantasia_cond: "CEDROS DO CAMPO", st_nome_cond: "CONDOMINIO CEDROS DO CAMPO", st_endereco_cond: "R Z", st_cidade_cond: "ARARAQUARA", st_uf_uf: "SP" },
  ];
  const r = async (nome) => await resolver_condominio({ nome }, { condos });
  check((await r("Condominio Vancouver")).id === 191, "ERP: prefixo 'Condominio' (era 'condomínio não encontrado')");
  check((await r("condomínio vancouver")).id === 191, "ERP: acento e caixa");
  check((await r("Vancouver")).id === 191, "ERP: nome curto (regressão)");
  check((await r("Cedros do Campo")).id === 187, "ERP: nome de 3 palavras não cai no 'Cedros' curto");
  check((await r("Cedros")).id === 175, "ERP: o exato ganha quando existe um condomínio com esse nome");
  const inex = await r("Xanadu");
  check(inex.encontrado === false, "ERP: nome inexistente continua não-encontrado");
}

fs.rmSync(raiz, { recursive: true, force: true });
if (falhas.length) { for (const f of falhas) console.error(`  ✗ ${f}`); assert.fail(`test_nome_condominio: ${falhas.length} de ${total} falharam`); }
console.log(`test_nome_condominio: ${ok}/${total} OK`);
