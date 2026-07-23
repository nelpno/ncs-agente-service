// test_candidatos_unidade.mjs — determinístico, sem rede.
// Conserta o beco-sem-saída do vídeo do Jatiúca (23/07): a equipe digitou "303 bloco 1" → "3N05
// bloco 01" → "0503 bloco 1" e recebia sempre "não localizei, digite exatamente como está no
// sistema" — empurrando a adivinhação de volta pra ela (a unidade real era "0503 BLOCO 1", da
// empresa Santa Barbara Participações). candidatosUnidade transforma isso numa LISTA de candidatos
// (com o nome do responsável) pra a equipe reconhecer e escolher — nunca escolhe sozinho.
import assert from "node:assert";
const { candidatosUnidade } = await import("../src/superlogica.mjs");

let ok = 0, total = 0;
const check = (c, m) => { total++; assert(c, m); ok++; };

const R = (unidade, bloco, id, nome) => ({ st_unidade_uni: unidade, st_bloco_uni: bloco, id_unidade_uni: id, st_nome_con: nome, id_label_tres: 1 });

// Cenário Jatiúca: Bloco 1 com várias unidades; a real é 0503 (Santa Barbara). A equipe digitou "303".
const rows = [
  R("0303", "BLOCO 1", 10, "MARIA SOUZA"),
  R("0503", "BLOCO 1", 11, "SANTA BARBARA PARTICIPACOES LTDA"),
  R("0503", "BLOCO 1", 11, "JOAO (procurador)"),
  R("0102", "BLOCO 2", 12, "PEDRO LIMA"),
];

// 1) Com o bloco informado, os candidatos priorizam aquele bloco e trazem o responsável (p/ reconhecer)
{
  const cands = candidatosUnidade(rows, { unidade: "303", bloco: "1" });
  check(cands.length >= 1, "retorna candidatos");
  const tem0503 = cands.find((c) => c.label.includes("0503"));
  check(!!tem0503, "a unidade real (0503) aparece nos candidatos, mesmo o número digitado sendo diferente");
  check(tem0503.responsaveis.some((n) => /SANTA BARBARA/i.test(n)), "mostra o responsável (Santa Barbara) p/ a equipe reconhecer");
  check(cands.every((c) => /BLOCO 1/i.test(c.label)) || cands[0].label.includes("BLOCO 1"), "prioriza o bloco informado");
}

// 2) Unidade distinta aparece UMA vez (agrupada por id), não uma linha por responsável
{
  const cands = candidatosUnidade(rows, { unidade: "0503", bloco: "1" });
  const ocorr = cands.filter((c) => c.id === 11);
  check(ocorr.length === 1, "0503 aparece uma vez só (agrupa os 2 responsáveis)");
  check(ocorr[0].responsaveis.length >= 1, "junta os responsáveis da unidade");
}

// 3) Sem linhas → lista vazia (não quebra)
{
  check(candidatosUnidade([], { unidade: "101", bloco: "1" }).length === 0, "sem dados → vazio");
}

// 4) Respeita o limite (não despeja o condomínio inteiro)
{
  const muitos = Array.from({ length: 30 }, (_, i) => R(String(100 + i), "A", 200 + i, `NOME ${i}`));
  check(candidatosUnidade(muitos, { unidade: "999", bloco: "A" }, 6).length <= 6, "respeita o limite");
}

console.log(`test_candidatos_unidade: ${ok}/${total} OK`);
