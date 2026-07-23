// test_verificar_enquadramento.mjs — determinístico, sem rede (chat injetado).
// Rede de segurança do #4 (23/07): impedir que a minuta cite um artigo que NÃO governa a conduta
// do relato (caso Allure: infiltração saiu com o capítulo de ruído de obra). O verificador é um 2º
// olho ISOLADO da pressão de escolha — vê só {relato, artigos} e diz se o artigo cobre o caso.
// Regra de bloqueio: só num veredito CONFIANTE de incompatibilidade (não/parcial). Erro de infra =
// fail-open (gera + loga) para uma queda do verificador não travar a equipe.
import assert from "node:assert";
import {
  enquadramentoIncompativel, parseVeredito, verificarEnquadramento,
} from "../src/verificar_enquadramento.mjs";

let ok = 0, total = 0;
const check = (c, m) => { total++; assert(c, m); ok++; };

// --- enquadramentoIncompativel: bloqueia só em não/parcial; sim e não-vereditos liberam (fail-open) ---
check(enquadramentoIncompativel({ cobre: "nao" }) === true, "'nao' bloqueia");
check(enquadramentoIncompativel({ cobre: "parcial" }) === true, "'parcial' bloqueia (não é enquadramento seguro)");
check(enquadramentoIncompativel({ cobre: "sim" }) === false, "'sim' libera");
check(enquadramentoIncompativel({ cobre: null }) === false, "veredito ilegível NÃO bloqueia (fail-open de infra)");
check(enquadramentoIncompativel(null) === false, "null NÃO bloqueia (fail-open de infra)");
check(enquadramentoIncompativel({ erro: "timeout" }) === false, "erro de infra NÃO bloqueia (fail-open)");

// --- parseVeredito: tolerante a texto ao redor do JSON; lixo => null ---
check(parseVeredito('{"cobre":"sim"}').cobre === "sim", "JSON puro");
check(parseVeredito('Claro: {"cobre":"nao"} — pronto').cobre === "nao", "JSON no meio de texto");
check(parseVeredito('cobre: parcial').cobre === "parcial", "fallback sem chaves JSON");
check(parseVeredito("qualquer coisa sem veredito") === null, "sem veredito => null");
check(parseVeredito('{"cobre":"talvez"}') === null, "valor fora do enum => null");

// --- verificarEnquadramento com chat injetado ---
{
  const chatFake = async () => ({ content: '{"cobre":"nao"}' });
  const v = await verificarEnquadramento({ relato: "vazamento no banheiro do vizinho de baixo", artigos: ["Ruídos de obra..."] }, { chat: chatFake });
  check(v.cobre === "nao", "propaga veredito do modelo");
  check(enquadramentoIncompativel(v) === true, "cenário do incidente => bloqueia");
}
{
  const chatFake = async () => ({ content: '{"cobre":"sim"}' });
  const v = await verificarEnquadramento({ relato: "som alto de madrugada", artigos: ["silêncio noturno 22h-7h..."] }, { chat: chatFake });
  check(enquadramentoIncompativel(v) === false, "match legítimo => libera");
}
{
  const chatBoom = async () => { throw new Error("429 sem crédito"); };
  const v = await verificarEnquadramento({ relato: "x", artigos: ["y"] }, { chat: chatBoom });
  check(v.cobre === null && !!v.erro, "erro do chat => veredito nulo com erro");
  check(enquadramentoIncompativel(v) === false, "erro de infra NÃO bloqueia (fail-open)");
}

console.log(`test_verificar_enquadramento: ${ok}/${total} OK`);
