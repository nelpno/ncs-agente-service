// test_modo_escrita.mjs — a tela de Aprovações precisa DIZER quando aprovar não grava.
//
// Por que existe (24/07): o Fernando viu a fila cheia e perguntou "podemos já começar a aprovar?".
// Hoje prod está com DRY_RUN_WRITES=true: clicar Aprovar marca o rascunho como gravado, some o card
// e fecha a linha na fila — mas NADA vai para o Superlógica, e não dá para desfazer (o CAS só aceita
// rascunho `pendente`). Sem aviso na tela, a equipe "resolve" pedidos de morador no vácuo.
//
// Duas decisões de projeto que os testes travam:
//  1. FAIL-SAFE: sem a variável (o Portal roda em container separado da Ana), assume modo teste.
//     Errar para o lado do aviso a mais é barato; errar para o lado do silêncio custa cadastro perdido.
//  2. WRITE_REAL_ACTIONS: a Onda C liga UMA ação por vez (ex. titularidade) com o DRY global ainda
//     ligado. Nesse estado o banner não pode dizer "nada grava" — seria mentira justamente quando o
//     risco é maior.
import assert from "node:assert";
import { modoEscrita } from "../src/aprovacoes.mjs";

let ok = 0, total = 0;
const check = (c, m) => { total++; assert(c, m); ok++; };

// --- fail-safe: sem configuração, avisa
{
  const m = modoEscrita({});
  check(m.teste === true, "env vazio → modo teste (fail-safe: na dúvida, avisa)");
  check(m.acoesReais.length === 0, "env vazio → nenhuma ação gravando de verdade");
}

// --- estado atual de produção (24/07)
{
  const m = modoEscrita({ DRY_RUN_WRITES: "true", WRITE_REAL_ACTIONS: "" });
  check(m.teste === true, "DRY_RUN_WRITES=true → modo teste");
}

// --- escrita real ligada de vez
{
  const m = modoEscrita({ DRY_RUN_WRITES: "false" });
  check(m.teste === false, "DRY_RUN_WRITES=false → grava de verdade, sem banner");
}

// --- Onda C: uma ação escapa do DRY global
{
  const m = modoEscrita({ DRY_RUN_WRITES: "true", WRITE_REAL_ACTIONS: "titularidade" });
  check(m.teste === true, "DRY global segue ligado para as demais ações");
  check(m.acoesReais.includes("titularidade"),
    "a ação liberada aparece — o banner não pode dizer que nada grava");
}

// --- lista com espaços/entradas vazias (o CSV é digitado à mão no deploy)
{
  const m = modoEscrita({ DRY_RUN_WRITES: "true", WRITE_REAL_ACTIONS: " titularidade , ,cadastro_inquilino " });
  check(m.acoesReais.length === 2, `CSV com espaços/vazios vira 2 ações (veio: ${m.acoesReais.length})`);
  check(m.acoesReais.includes("cadastro_inquilino"), "nome da ação sai sem espaço em volta");
}

// --- ação real listada mas DRY global desligado: não há nada de excepcional a avisar
{
  const m = modoEscrita({ DRY_RUN_WRITES: "false", WRITE_REAL_ACTIONS: "titularidade" });
  check(m.teste === false && m.acoesReais.length === 0,
    "com escrita real global, a lista por-ação é irrelevante (não vira aviso)");
}

console.log(`test_modo_escrita: ${ok}/${total} OK`);
