// test_garantidora_estagiario.mjs — determinístico (sem LLM, sem rede): a tool consultar_garantidora
// está registrada no Estagiário e o runTool mapeia condominio(nome) -> módulo da Ana (src/garantidora.mjs).
// Cobre o furo do Fernando (vídeo/WhatsApp 17/07): o Estagiário dizia que a NCS emite o boleto do
// Praças do Sol — que é garantidora (BV GARANTIA). Reusa a MESMA base da Ana. Exit 1 em falha.
import { TOOLS, runTool } from "../src/agent.mjs";

let falhas = 0;
const ok = (cond, msg) => { console.log(`${cond ? "OK  " : "FALHA"} ${msg}`); if (!cond) falhas++; };
const call = (args) => runTool("consultar_garantidora", args, {});

// 0) a tool existe no cardápio exposto ao modelo (senão o LLM nunca a chama)
ok(TOOLS.some((t) => t.function?.name === "consultar_garantidora"), "consultar_garantidora registrada em TOOLS");

// 1) Praças do Sol (o caso do Fernando) por NOME -> garantidora total BV GARANTIA (NCS não emite)
const pracas = await call({ condominio: "Praças do Sol" });
ok(pracas.tem && pracas.tipo === "total" && pracas.garantidora?.nome === "BV GARANTIA",
  `Praças do Sol -> total / BV GARANTIA (wpp ${pracas.garantidora?.whatsapp})`);
ok(/bvgarantia/i.test(pracas.garantidora?.email || ""), "Praças do Sol -> canais da garantidora presentes (não manda pro Gruvi)");

// 2) Vale Supremo por NOME -> total / ASSISCON (o falso-negativo de 16/07: bot dizia "não localizei")
const vale = await call({ condominio: "Vale Supremo" });
ok(vale.tem && vale.tipo === "total" && vale.garantidora?.nome === "ASSISCON", "Vale Supremo -> total / ASSISCON");

// 3) Allure -> exceção tipo allure (boleto normal a NCS gera; inadimplência +30d é da garantidora)
const allure = await call({ condominio: "Allure" });
ok(allure.tem && allure.tipo === "allure", "Allure -> tipo allure (boleto normal no Gruvi)");

// 4) condomínio SEM garantidora (Lume) -> tem:false: o bot segue orientando o app Gruvi normalmente
ok((await call({ condominio: "Lume" })).tem === false, "Lume -> sem garantidora (tem:false, segue Gruvi)");

// 5) id_condominio também casa e vence o nome (Praças do Sol = 176)
ok((await call({ condominio: "qualquer", id_condominio: "176" })).garantidora?.nome === "BV GARANTIA",
  "id_condominio 176 -> BV GARANTIA (id vence o nome)");

console.log(`\n${falhas === 0 ? "TODOS OS TESTES VERDES" : falhas + " FALHA(S)"}`);
process.exit(falhas === 0 ? 0 : 1);
