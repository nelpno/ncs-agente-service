// test_aprovacoes.mjs — aba Aprovações (spec Onda 1 §4.4): gating puro, máscara de CPF (LGPD),
// query da fila (db injetável) e chamada ao EXECUTOR ÚNICO (fetch injetável, sem rede real).
import assert from "node:assert";
process.env.SESSION_SECRET = "x";

const A = await import("../src/aprovacoes.mjs");
let ok = 0;

// --- gating: só quem tem pode_aprovar (spec: "Sem RBAC", nem owner/admin passam de graça) ---
{
  assert.strictEqual(A.podeVerAprovacoes({ podeAprovar: true, papel: "funcionario" }), true);
  assert.strictEqual(A.podeVerAprovacoes({ podeAprovar: false, papel: "owner" }), false, "owner sem o flag NÃO vê (sem RBAC)");
  assert.strictEqual(A.podeVerAprovacoes({ podeAprovar: false, papel: "admin" }), false);
  assert.strictEqual(A.podeVerAprovacoes(null), false, "sem sessão → false, não lança");
  assert.strictEqual(A.podeVerAprovacoes({}), false);
  ok++;
}

// --- mascararObjeto: CPF mascarado em string simples, dentro de objeto aninhado e em array; resto intacto ---
{
  assert.strictEqual(A.mascararObjeto("123.456.789-01"), "***");
  assert.strictEqual(A.mascararObjeto(null), null);
  assert.strictEqual(A.mascararObjeto(42), 42);
  const obj = {
    nome: "Fulano de Tal",
    cpf: "123.456.789-01",
    contatos: [{ ST_CPF_CON: "98765432100" }, { obs: "sem cpf aqui" }],
    aninhado: { doc: "cpf 111.222.333-44 no meio da frase" },
  };
  const out = A.mascararObjeto(obj);
  assert.strictEqual(out.nome, "Fulano de Tal", "campo sem CPF não muda");
  assert.strictEqual(out.cpf, "***");
  assert.strictEqual(out.contatos[0].ST_CPF_CON, "***");
  assert.strictEqual(out.contatos[1].obs, "sem cpf aqui");
  assert.ok(out.aninhado.doc.includes("***") && !/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/.test(out.aninhado.doc), "CPF mascarado mesmo no meio de frase, aninhado");
  ok++;
}

// --- paraCard: monta só os campos da tela, CPF mascarado em dados e conflito ---
{
  const draft = {
    id: "d1",
    acao: "cadastro_inquilino",
    dados: { nome: "Ciclano", cpf: "123.456.789-01", unidade: "101" },
    snapshot: { antigo: "não deve vazar pro card" },
    conflito: { existente_cpf: "987.654.321-00" },
    solicitante: "morador via WhatsApp",
    time_aprovador: "Atendimento geral",
    criado_em: "2026-07-11T10:00:00Z",
    expira_em: "2026-07-14T10:00:00Z",
  };
  const card = A.paraCard(draft);
  assert.strictEqual(card.id, "d1");
  assert.strictEqual(card.acao, "cadastro_inquilino");
  assert.strictEqual(card.dados.cpf, "***");
  assert.strictEqual(card.dados.unidade, "101");
  assert.strictEqual(card.conflito.existente_cpf, "***");
  assert.strictEqual(card.solicitante, "morador via WhatsApp");
  assert.strictEqual(card.time_aprovador, "Atendimento geral");
  assert.strictEqual(card.criado_em, "2026-07-11T10:00:00Z");
  assert.strictEqual(card.expira_em, "2026-07-14T10:00:00Z");
  assert.strictEqual(card.snapshot, undefined, "snapshot não vai pro card (só auditoria)");
  ok++;
}
// paraCard sem conflito → null (não quebra)
{
  const card = A.paraCard({ id: "d2", acao: "x", dados: {}, criado_em: "2026-07-11T10:00:00Z" });
  assert.strictEqual(card.conflito, null);
  ok++;
}

// --- listarPendentes: filtra status=pendente, ordena por criado_em asc, devolve cards mascarados ---
{
  const db = {
    sbSelect: async (t, q) => {
      assert.strictEqual(t, "escrita_drafts");
      assert.ok(q.includes("status=eq.pendente"), "filtra só pendente");
      assert.ok(q.includes("order=criado_em.asc"), "mais antiga primeiro (FIFO)");
      return [{ id: "d1", acao: "a", dados: { cpf: "123.456.789-01" }, criado_em: "2026-07-11T10:00:00Z" }];
    },
  };
  const itens = await A.listarPendentes(db);
  assert.strictEqual(itens.length, 1);
  assert.strictEqual(itens[0].dados.cpf, "***", "veio mascarado da listagem também");
  ok++;
}

// --- aprovar/rejeitar: chama o executor único com o shape certo; NCS_AGENTE_URL default e via env ---
{
  delete process.env.NCS_AGENTE_URL;
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, json: async () => ({ ok: true, gravado: true }) };
  };
  const out = await A.aprovar({ draftId: "d1", aprovador: { user_id: "u1", nome: "Malu", papel: "funcionario" }, motivo: null }, fakeFetch);
  assert.strictEqual(calls[0].url, "http://ncs-agente:8080/write/aprovar", "default URL (rede interna do VPS)");
  assert.strictEqual(calls[0].opts.method, "POST");
  const body = JSON.parse(calls[0].opts.body);
  assert.strictEqual(body.draft_id, "d1");
  assert.strictEqual(body.aprovador.user_id, "u1");
  assert.strictEqual(out.gravado, true);
  ok++;
}
{
  process.env.NCS_AGENTE_URL = "http://ncs-agente:8080/"; // barra final não deve duplicar no caminho
  const calls = [];
  const fakeFetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, json: async () => ({ ok: true, rejeitado: true }) }; };
  const out = await A.rejeitar({ draftId: "d2", aprovador: { user_id: "u2", nome: "Fernando", papel: "admin" }, motivo: "dado incompleto" }, fakeFetch);
  assert.strictEqual(calls[0].url, "http://ncs-agente:8080/write/rejeitar");
  const body = JSON.parse(calls[0].opts.body);
  assert.strictEqual(body.motivo, "dado incompleto");
  assert.strictEqual(out.rejeitado, true);
  delete process.env.NCS_AGENTE_URL;
  ok++;
}
// executor responde erro (não-ok) → lança com a mensagem do corpo
{
  const fakeFetch = async () => ({ ok: false, status: 409, json: async () => ({ erro: "conflito de CAS" }) });
  await assert.rejects(() => A.aprovar({ draftId: "d3", aprovador: { user_id: "u1" } }, fakeFetch), /409/);
  ok++;
}

console.log(`test_aprovacoes: ${ok}/8 OK`);
