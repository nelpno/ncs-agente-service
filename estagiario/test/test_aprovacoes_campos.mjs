// test_aprovacoes_campos.mjs — o "Ver detalhes" do card tem que mostrar o dado como GENTE lê,
// não como a API guarda.
//
// Por que importa (caso real, print do Fernando 24/07): no MESMO card, o resumo dizia "a partir de
// 01/08/2026" e o detalhe dizia "Entrada 08/01/2026". A API do Superlógica usa MM/DD/AAAA; o
// `renderDl` do frontend despejava `draft.dados` CRU, então a mesma data aparecia duas vezes, com
// dois significados. Quem aprova lendo o detalhe entende 8 de janeiro. Mesma história na unidade:
// resumo "TORRE 04 - BLOCO C / 001" x detalhe "13754" (o id interno do ERP).
//
// A ação JÁ monta `campos` formatados (cadastro_inquilino.render) — o `paraCard` é que descartava.
// Aqui a regra segue na ação (fonte única): o teste prova que o card CARREGA o que ela calculou.
import assert from "node:assert";
import * as A from "../src/aprovacoes.mjs";

let ok = 0, total = 0;
const check = (c, m) => { total++; assert(c, m); ok++; };
const acha = (campos, label) => (campos || []).find((c) => c.label === label);

// Fixture = o draft real da Gabriela (NCS-A-26, 23/07): entrada 08/01/2026 no formato da API
// (= 1º de agosto) e a unidade com rótulo do ERP. CPF fictício.
const draft = {
  id: "d1", acao: "cadastro_inquilino", status: "pendente", time_aprovador: "Recepção",
  criado_em: "2026-07-23T15:57:38Z", snapshot: [],
  dados: {
    id_condominio: "176", id_unidade: "13754", unidade_label: "TORRE 04 - BLOCO C / 001",
    condominio_nome: "VITTA PRACAS DO SOL", nome: "Gabriela de Lurdes Medeiros Dantas",
    papel: "inquilino", data_entrada: "08/01/2026", responsavel_cobranca: "proprietario",
    cpf: "529.982.247-25", email: "gabi@exemplo.com.br", telefone: "16991234567",
  },
};

// --- o card carrega os campos formatados da ação
{
  const card = A.paraCard(draft);
  check(Array.isArray(card.campos), "card expõe `campos` como lista");
  check(card.campos.length > 0, "campos não vem vazio para uma ação conhecida");
}

// --- a data de entrada é a MESMA do resumo (o bug: 08/01 no detalhe x 01/08 no resumo)
{
  const card = A.paraCard(draft);
  const entrada = acha(card.campos, "Entrada");
  check(entrada, "campo `Entrada` presente");
  check(entrada.valor === "01/08/2026",
    `Entrada em DD/MM/AAAA como no resumo (veio: ${entrada && entrada.valor})`);
  check(card.resumo.includes(entrada.valor),
    "detalhe e resumo dizem a MESMA data (foi a contradição vista no print)");
}

// --- a unidade é o rótulo do ERP, nunca o id interno
{
  const card = A.paraCard(draft);
  const unid = acha(card.campos, "Unidade");
  check(unid && unid.valor === "TORRE 04 - BLOCO C / 001",
    `Unidade pelo rótulo, não pelo id (veio: ${unid && unid.valor})`);
  check(!(card.campos || []).some((c) => String(c.valor) === "13754"),
    "o id interno da unidade não aparece em campo nenhum");
}

// --- LGPD: os campos passam pela mesma máscara do resto do card
{
  const card = A.paraCard(draft);
  check(!/529\.982\.247-25/.test(JSON.stringify(card.campos)), "CPF mascarado também nos campos");
}

// --- robustez: ação desconhecida não derruba a fila (mesmo contrato de resumo/alertas)
{
  const card = A.paraCard({ id: "d2", acao: "acao_que_nao_existe", dados: { x: 1 }, criado_em: "x" });
  check(Array.isArray(card.campos) && card.campos.length === 0, "ação desconhecida → campos vazio, sem lançar");
  check(card.id === "d2", "ação desconhecida → o card ainda é montado");
}

console.log(`test_aprovacoes_campos: ${ok}/${total} OK`);
