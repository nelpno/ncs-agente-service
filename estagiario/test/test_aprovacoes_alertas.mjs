// test_aprovacoes_alertas.mjs — o card da aba "Aprovações" tem que carregar o que a AÇÃO calculou:
// o `resumo` (decisão em 5s) e os `alertas` (o que o aprovador precisa fazer à mão).
//
// Por que importa: quando o inquilino assume a cobrança, o proprietário TEM que virar "só extras"
// no Superlógica — senão a taxa sai duplicada. Se essa instrução não chega na TELA, o efeito
// acontece calado (spec Onda 1 §2.2 "nada falha calado"). Medido em 14/07: o card não trazia nada
// disso — `paraCard` montava só `dados` cru.
//
// Sem duplicar regra: o Portal roda a MESMA imagem do agente-service (CHAT_IMAGE = a imagem da Ana),
// então importa o registry e chama `acao.render()` — a ação segue sendo a fonte única da regra.
import assert from "node:assert";
import * as A from "../src/aprovacoes.mjs";

let ok = 0, total = 0;
const check = (c, m) => { total++; assert(c, m); ok++; };

const draftInq = {
  id: "d1", acao: "cadastro_inquilino", status: "pendente", time_aprovador: "Recepção",
  criado_em: "2026-07-14T10:00:00Z", snapshot: [],
  dados: { id_condominio: "179", id_unidade: "900", nome: "João Silva", papel: "inquilino",
    data_entrada: "06/30/2026", responsavel_cobranca: "inquilino" },
};
const draftProp = { ...draftInq, id: "d2", dados: { ...draftInq.dados, responsavel_cobranca: "proprietario" } };

// --- alertas chegam no card
{
  const card = A.paraCard(draftInq);
  check(Array.isArray(card.alertas), "card expõe `alertas` como lista");
  check(card.alertas.some((a) => /extra/i.test(a) && /propriet/i.test(a)),
    "inquilino responsável → card traz a instrução de virar o proprietário p/ só extras");
}
// --- controle: caso padrão não inventa alerta
{
  const card = A.paraCard(draftProp);
  check((card.alertas || []).length === 0, "caso padrão → sem alertas (controle: o alerta não é decorativo)");
}
// --- resumo legível
{
  const card = A.paraCard(draftInq);
  check(typeof card.resumo === "string" && /João Silva/.test(card.resumo) && /900/.test(card.resumo),
    "card traz o resumo em texto (quem entra, em qual unidade)");
}
// --- robustez: ação desconhecida não pode derrubar a fila inteira
{
  const card = A.paraCard({ id: "d3", acao: "acao_que_nao_existe", dados: {}, criado_em: "2026-07-11T10:00:00Z" });
  check(Array.isArray(card.alertas) && card.alertas.length === 0, "ação desconhecida → alertas vazio, sem lançar");
  check(card.id === "d3", "ação desconhecida → o card ainda é montado (a fila não some)");
}
// --- LGPD: o resumo/alerta passam pela mesma máscara do resto do card
{
  const comCpf = { ...draftInq, id: "d4", dados: { ...draftInq.dados, nome: "João 529.982.247-25 Silva" } };
  const card = A.paraCard(comCpf);
  check(!/529\.982\.247-25/.test(JSON.stringify(card)), "CPF não vaza pelo resumo/alertas (máscara aplicada)");
}

console.log(`test_aprovacoes_alertas: ${ok}/${total} OK`);

// --- título humano: "cadastro_inquilino" é enum de banco, não texto de tela
{
  const card = A.paraCard(draftInq);
  check(card.titulo && !/_/.test(card.titulo), `card traz título legível (veio: ${card.titulo})`);
  check(/cadastro/i.test(card.titulo), "título diz do que se trata");
  const semAcao = A.paraCard({ id: "d5", acao: "nao_existe", dados: {}, criado_em: "x" });
  check(typeof semAcao.titulo === "string", "ação desconhecida ainda tem título (cai no id da ação)");
}
console.log(`(com título) ${ok}/${total} OK`);
