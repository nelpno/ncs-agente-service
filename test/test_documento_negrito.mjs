// test_documento_negrito.mjs — dois pedidos reais da equipe no 1º dia de uso (14/07):
//   (A) Luciana: "coloque em negrito as partes mais importantes" → o robô dizia "não formato o arquivo por aqui".
//   (B) Síndico do Garden Place: "coloca as 2 infrações na mesma notificação" → o robô obrigava a escolher uma
//       ("qual enquadramento prefere usar como principal") e a outra ficava FORA do enquadramento.
// Determinístico: monta o doc + renderiza o HTML, sem LLM e sem Superlógica.
import assert from "node:assert";
import { montarDoc } from "../gerador/src/gerar-lib.mjs";
import { renderHTML } from "../gerador/src/template.mjs";
import fs from "node:fs";

const dados = JSON.parse(fs.readFileSync(new URL("../gerador/dados/vancouver.json", import.meta.url), "utf8"));
const CAD = { nome: "COND VANCOUVER", endereco: "RUA X, 1", cep: "14800-000", cidade_uf: "ARARAQUARA/SP", cidade_fecho: "Araraquara" };
const ID1 = "descarte_indevido_objetos", ID2 = "danos_jardim";
const base = (over = {}) => ({
  tipo: "notificacao", infracao_id: ID1,
  destinatario: { nome: "Fulano de Tal", genero: "M", apartamento: "12 A" },
  relato: "No dia 11 de julho de 2026, às 23h15, foi constatado o descarte de objetos na área comum.",
  data_documento: "14 de julho de 2026", ...over,
});
const html = (oc) => renderHTML(montarDoc(dados, oc, CAD));
let ok = 0;

// ---------- (A) negrito ----------
// 1) estrutural sai sozinho, sem o LLM pedir nada
{
  const h = html(base());
  assert.ok(h.includes("<b>Fulano de Tal</b>"), "destinatário deveria sair em negrito");
  assert.ok(h.includes("<b>apartamento 12 A</b>"), "unidade deveria sair em negrito");
  assert.ok(/<b>[^<]*ARTIGO 7/.test(h), "a referência do artigo deveria sair em negrito");
  ok++;
}
// 2) destaque do relato: o trecho pedido sai em negrito
{
  const h = html(base({ destaques: ["às 23h15"] }));
  assert.ok(h.includes("<b>às 23h15</b>"), "o trecho destacado deveria sair em negrito");
  ok++;
}
// 3) destaque que NÃO está no relato é ignorado — e o documento sai igual (falha graciosa)
{
  const h = html(base({ destaques: ["texto que nao existe no relato"] }));
  assert.ok(!h.includes("<b>texto que nao existe"), "não pode negritar trecho que não está no relato");
  assert.ok(h.includes("descarte de objetos na área comum"), "o relato tem que sair inteiro mesmo assim");
  ok++;
}
// 4) o relato continua ESCAPADO (a proteção de hoje não pode cair por causa do negrito)
{
  const h = html(base({ relato: 'Fato <script>alert(1)</script> ocorrido às 23h15', destaques: ["às 23h15"] }));
  assert.ok(h.includes("&lt;script&gt;"), "HTML no relato tem que sair escapado");
  assert.ok(!h.includes("<script>"), "não pode injetar HTML no documento");
  assert.ok(h.includes("<b>às 23h15</b>"), "o destaque tem que funcionar mesmo com texto escapado junto");
  ok++;
}
// 5) destaque com caractere que o escape mexe (&) tem que casar mesmo assim
{
  const h = html(base({ relato: "Houve dano em Silva & Filhos durante a obra.", destaques: ["Silva & Filhos"] }));
  assert.ok(h.includes("<b>Silva &amp; Filhos</b>"), "destaque com & deveria casar após o escape");
  ok++;
}
// 6) nunca vaza marcador de markdown no documento
{
  const h = html(base({ destaques: ["às 23h15"] }));
  assert.ok(!h.includes("**"), "documento não pode conter **");
  ok++;
}
// 7) multa: valor e mês saem em negrito
{
  const h = html(base({ tipo: "multa", nivel_reincidencia: 2, penalidade: { mes_boleto: "agosto de 2026" } }));
  assert.ok(/<b>0?2 \([^)]+\) taxas condominiais<\/b>/.test(h), "valor da multa deveria sair em negrito");
  assert.ok(h.includes("<b>mês de agosto de 2026</b>"), "mês do boleto deveria sair em negrito");
  ok++;
}

// ---------- (B) duas infrações ----------
// 8) as DUAS entram: concordância no plural + os dois artigos no corpo
{
  const doc = montarDoc(dados, base({ infracao_id: [ID1, ID2] }), CAD);
  assert.ok(doc.fundamento.startsWith("Considerando o que dispõem o "), `esperava plural, veio: ${doc.fundamento.slice(0, 40)}`);
  assert.ok(doc.fundamento.includes(" e o "), "deveria juntar as duas referências");
  assert.strictEqual(doc.textos_artigo.length, 2, "os dois textos de artigo têm que ir no documento");
  const h = renderHTML(montarDoc(dados, base({ infracao_id: [ID1, ID2] }), CAD));
  assert.strictEqual((h.match(/class="artigo"/g) || []).length, 2, "o documento tem que mostrar os 2 artigos");
  ok++;
}
// 9) compatibilidade: string continua saindo no singular, com 1 artigo
{
  const doc = montarDoc(dados, base(), CAD);
  assert.ok(doc.fundamento.startsWith("Considerando o que dispõe o "), "1 infração = singular");
  assert.strictEqual(doc.textos_artigo.length, 1);
  assert.ok(doc.texto_artigo, "campo antigo texto_artigo preservado");
  ok++;
}
// 10) id inválido no meio da lista falha dizendo quais existem (não gera doc torto)
{
  assert.throws(() => montarDoc(dados, base({ infracao_id: [ID1, "nao_existe"] }), CAD),
    (e) => /nao_existe/.test(e.message) && Array.isArray(e.infracoes_disponiveis), "erro deveria citar o id ruim + as opções");
  ok++;
}
// 11) multa com 2 infrações = UMA penalidade (o valor é pelo nível; o síndico decide o resto)
{
  const doc = montarDoc(dados, base({ tipo: "multa", infracao_id: [ID1, ID2], nivel_reincidencia: 2, penalidade: { mes_boleto: "agosto de 2026" } }), CAD);
  assert.strictEqual((doc.penalidade_paragrafo.match(/será aplicada multa/g) || []).length, 1, "não pode duplicar a multa por infração");
  ok++;
}
// 12) lista duplicada/vazia não quebra
{
  const doc = montarDoc(dados, base({ infracao_id: [ID1, ID1] }), CAD);
  assert.strictEqual(doc.textos_artigo.length, 1, "id repetido deveria ser deduplicado");
  assert.throws(() => montarDoc(dados, base({ infracao_id: [] }), CAD), /obrigat/i);
  ok++;
}

console.log(`test_documento_negrito: ${ok}/12 OK`);
