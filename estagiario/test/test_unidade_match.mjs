// test_unidade_match.mjs — casamento de unidade do Superlógica p/ documento (notificação/multa/CND).
// Nasceu do uso real de 14/07: a equipe digitava "apto 101 bloco 1" e recebia "não encontrei" —
// o dado existia, mas o match era byte-a-byte contra "APTO 0101"/"BLOCO 01".
// Formatos reais (amostrados ao vivo): "APTO 0101"+"BLOCO 01" (177), "0303"+"BL 18" (allure),
// "0032"+"APTO" (angelo-smirne), "0091"+"Edifício V" (barbieri), "1501"+"APTO" (lume).
// ⚠️ Documento tem peso jurídico: na dúvida PERGUNTA, nunca escolhe.
import assert from "node:assert";
const { _acharUnidade } = await import("../src/superlogica.mjs");
let ok = 0;

const R = (unidade, bloco, id, nome = "FULANO") =>
  ({ st_unidade_uni: unidade, st_bloco_uni: bloco, id_unidade_uni: id, st_nome_con: nome, id_label_tres: 1 });

// 1) PARQUE AMARIGE (177) — o caso que travou a Sophia hoje. Unidade gravada "APTO 0101"/"BLOCO 01".
{
  const rows = [R("APTO 0101", "BLOCO 01", 900, "JULIANA"), R("APTO 0101", "BLOCO 01", 900, "MARCOS"), R("APTO 0102", "BLOCO 01", 901)];
  // formato exato do sistema (o que já funcionava)
  assert.strictEqual(_acharUnidade(rows, { unidade: "APTO 0101", bloco: "BLOCO 01" }).status, "ok");
  assert.strictEqual(_acharUnidade(rows, { unidade: "APTO 0101", bloco: "BLOCO 01" }).linhas.length, 2, "2 responsáveis da MESMA unidade");
  // o que a equipe realmente digita (hoje falhava)
  for (const q of [{ unidade: "0101", bloco: "01" }, { unidade: "101", bloco: "1" }, { unidade: "apto 101", bloco: "bloco 1" }, { unidade: "APTO 0101", bloco: "01" }]) {
    const r = _acharUnidade(rows, q);
    assert.strictEqual(r.status, "ok", `deveria achar com unidade="${q.unidade}" bloco="${q.bloco}"`);
    assert.strictEqual(r.linhas[0].id_unidade_uni, 900);
  }
  ok++;
}

// 2) TIVOLI (164) — RISCO JURÍDICO REAL: "10 G" e "010 G" são unidades DIFERENTES (id 12217 x 16804),
//    de proprietários diferentes. Normalizar zero à esquerda NÃO pode escolher sozinho.
{
  const rows = [R("10", "G", 12217, "PEDRO"), R("010", "G", 16804, "ARO")];
  // exato continua mandando: quem digita certo recebe a unidade certa
  assert.strictEqual(_acharUnidade(rows, { unidade: "10", bloco: "G" }).linhas[0].id_unidade_uni, 12217);
  assert.strictEqual(_acharUnidade(rows, { unidade: "010", bloco: "G" }).linhas[0].id_unidade_uni, 16804);
  // sem match exato → normalizado bate nos DOIS → tem que PERGUNTAR, nunca escolher
  const amb = _acharUnidade(rows, { unidade: "0010", bloco: "G" });
  assert.strictEqual(amb.status, "ambiguo", "duas unidades distintas → ambíguo");
  assert.strictEqual(amb.opcoes.length, 2);
  assert.ok(amb.opcoes.every((o) => /G/.test(o)), "as opções mostram como está gravado, p/ a pessoa escolher");
  ok++;
}

// 3) Formatos variados dos outros condomínios (amostrados ao vivo)
{
  assert.strictEqual(_acharUnidade([R("0303", "BL 18", 1)], { unidade: "303", bloco: "18" }).status, "ok", "allure: 0303 + BL 18");
  assert.strictEqual(_acharUnidade([R("0303", "BL 18", 1)], { unidade: "303", bloco: "bl 18" }).status, "ok");
  assert.strictEqual(_acharUnidade([R("1501", "APTO", 2)], { unidade: "1501" }).status, "ok", "lume: bloco literal 'APTO'");
  assert.strictEqual(_acharUnidade([R("0091", "Edifício V", 3)], { unidade: "91", bloco: "V" }).status, "ok", "barbieri: Edifício V");
  assert.strictEqual(_acharUnidade([R("0013", "A", 4)], { unidade: "13", bloco: "A" }).status, "ok", "garden place: o caso da Luciana (13 A)");
  ok++;
}

// 4) Não achou é não achou — não pode "chutar o mais parecido"
{
  const rows = [R("0303", "BL 18", 1), R("0304", "BL 18", 2)];
  assert.strictEqual(_acharUnidade(rows, { unidade: "999", bloco: "BL 18" }).status, "nao_encontrado");
  assert.strictEqual(_acharUnidade(rows, { unidade: "303", bloco: "BL 99" }).status, "nao_encontrado", "bloco errado não pode ser ignorado");
  ok++;
}

// 5) Bloco vazio: quem não informa bloco recebe todas as unidades com aquele número (e escolhe)
{
  const rows = [R("0101", "BLOCO 01", 10), R("0101", "BLOCO 02", 11)];
  const r = _acharUnidade(rows, { unidade: "101" });
  assert.strictEqual(r.status, "ambiguo", "mesmo número em blocos diferentes → perguntar o bloco");
  assert.strictEqual(r.opcoes.length, 2);
  ok++;
}

console.log(`test_unidade_match: ${ok}/5 grupos OK`);
