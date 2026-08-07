// test_cobrador_oficial.mjs — determinístico, sem LLM, sem rede.
// Nasce da conv 693 (06/08, Vida Plena): o morador recebeu WhatsApp de "Vitória (16) 3214-5117"
// cobrando e perguntou se era golpe. A Ana respondeu que NÃO CONSEGUIA VALIDAR. O telefone é do
// escritório CHAGAS & OLIVEIRA, que está na planilha como responsável pela cobrança daquele condomínio.
//
// Isso ficou parado porque a planilha e a equipe pareciam se contradizer: no mesmo dia um atendente
// disse ao morador que o escritório "não tem vínculo com a administradora". O Fernando resolveu em
// 07/08: "o escritório é contratado pelo condomínio, e não pela NCS" — as duas frases eram verdade.
// E definiu o comportamento: "é ela conseguir dizer na hora se a cobrança que a pessoa recebeu é
// oficial ou não. Se o morador tiver dúvida de golpe, atribua a conversa para humano responsável
// da carteira de atendimento."
//
// 🔴 As duas travas que este teste existe para guardar:
//   1. A Ana CONFIRMA o que é oficial; ela NUNCA acusa de golpe. Chamar de fraude uma cobrança
//      legítima de um escritório real é acusação contra terceiro — e ela não tem como saber.
//   2. Esta tool fala com MORADOR: não pode devolver juros, multa, honorários nem parcelamento.
//      Isso é conversa de síndico, e vive na consultar_parametros_cobranca (só no Estagiário).
import assert from "node:assert";
import { verificar_cobranca_oficial, _casaCobrador } from "../src/cobrador.mjs";

let ok = 0, total = 0;
const check = (c, m) => { total++; assert(c, m); ok++; };

// ---------- 1) O caso REAL: Chagas & Oliveira no Vida Plena ----------
{
  const r = verificar_cobranca_oficial({ condominio: "Vida Plena", quem: "Chagas e Oliveira" });
  check(r.status === "confere", `deveria conferir, veio ${r.status}`);
  check(/chagas/i.test(r.cobrador), `identifica o escritório, veio ${r.cobrador}`);
  check(/contratad[oa] pelo condom[íi]nio/i.test(r.mensagem), "diz que quem contrata é o CONDOMÍNIO (correção do Fernando)");
  check(!/pela NCS|nossa cobran/i.test(r.mensagem), "NÃO diz que o escritório é contratado pela NCS");
}
// grafias que o morador usa de verdade
for (const q of ["CHAGAS & OLIVEIRA", "chagas oliveira", "escritório Chagas", "chagas & oliveira advogados"]) {
  const r = verificar_cobranca_oficial({ condominio: "Vida Plena", quem: q });
  check(r.status === "confere", `"${q}" deveria conferir, veio ${r.status}`);
}

// ---------- 2) 🔴 NUNCA acusa de golpe ----------
{
  const r = verificar_cobranca_oficial({ condominio: "Vida Plena", quem: "Escritorio Fulano de Tal" });
  check(r.status === "nao_confere", `não deveria conferir, veio ${r.status}`);
  const txt = JSON.stringify(r).toLowerCase();
  check(!/golpe|fraude|falso|estelionat|criminos/.test(txt), "🔴 a resposta NÃO contém acusação de golpe/fraude");
  check(/equipe|atendente|humano|confer/i.test(r.mensagem), "encaminha para conferência humana");
  check(r.transferir_humano === true, "sinaliza transferência (regra do Fernando p/ dúvida de golpe)");
}

// ---------- 3) 🔴 NUNCA vaza percentual para o morador ----------
{
  for (const args of [{ condominio: "Vida Plena", quem: "Chagas" }, { condominio: "Rosa de Ouro" }, { condominio: "Tivoli" }]) {
    const r = verificar_cobranca_oficial(args);
    const txt = JSON.stringify(r);
    check(!/juros|multa|honorar|parcelamento|pode_cobrar/i.test(txt), `🔴 sem percentual/condição no retorno: ${JSON.stringify(args)}`);
  }
}

// ---------- 4) Sem informar quem: diz quem SÃO os oficiais ----------
{
  const r = verificar_cobranca_oficial({ condominio: "Vida Plena" });
  check(r.status === "sem_quem", `veio ${r.status}`);
  check(Array.isArray(r.oficiais) && r.oficiais.length > 0, "lista os responsáveis oficiais");
  check(r.oficiais.some((o) => /chagas/i.test(o.nome)), "o Chagas está entre eles");
}

// ---------- 5) Cobrança da própria NCS ----------
{
  const r = verificar_cobranca_oficial({ condominio: "Rosa de Ouro", quem: "NCS" });
  check(r.status === "confere", `cobrança NCS confere, veio ${r.status}`);
}

// ---------- 6) Ambiguidade continua ambígua (não escolhe por conta própria) ----------
{
  const r = verificar_cobranca_oficial({ condominio: "Cedros", quem: "Chagas" });
  check(r.status === "condominio_ambiguo", `Cedros serve a 2 condomínios, veio ${r.status}`);
  check(Array.isArray(r.candidatos) && r.candidatos.length >= 2, "devolve os candidatos p/ perguntar");
}

// ---------- 7) Fora da base: não confirma nem desmente ----------
{
  const r = verificar_cobranca_oficial({ condominio: "Condominio Que Nao Existe", quem: "Chagas" });
  check(r.status === "condominio_desconhecido", `veio ${r.status}`);
  check(!/confer/i.test(String(r.cobrador || "")), "não inventa cobrador");
  check(r.transferir_humano === true, "sem base, vai para humano");
}

// ---------- 8) Sem condomínio informado: pergunta, não chuta ----------
{
  const r = verificar_cobranca_oficial({ quem: "Chagas" });
  check(r.status === "condominio_nao_informado", `veio ${r.status}`);
}

// ---------- 9) _casaCobrador: os dois lados ----------
{
  check(_casaCobrador("CHAGAS & OLIVEIRA", "chagas e oliveira") === true, "casa & com e");
  check(_casaCobrador("CHAGAS & OLIVEIRA", "Chagas") === true, "casa nome parcial significativo");
  check(_casaCobrador("Dr Everton Marchese", "Everton") === true, "casa o sobrenome/nome do advogado");
  // 🔴 "Dr" é palavra estrutural: sozinha casaria 3 escritórios diferentes
  check(_casaCobrador("Dr Everton Marchese", "Dr") === false, "🔴 'Dr' sozinho NÃO casa");
  check(_casaCobrador("Dr Everton Marchese", "Dr Sergio") === false, "🔴 'Dr Sergio' não casa Everton");
  check(_casaCobrador("PERI LOPES", "Chagas") === false, "escritório diferente não casa");
  check(_casaCobrador("CHAGAS & OLIVEIRA", "") === false, "vazio não casa");
  check(_casaCobrador("", "chagas") === false, "oficial vazio não casa");
}

// ---------- 10) Telefone e e-mail do contato oficial ----------
{
  const r = verificar_cobranca_oficial({ condominio: "Vida Plena", quem: "contato@chagasoliveira.adv.br" });
  check(r.status === "confere", `e-mail oficial confere, veio ${r.status}`);
}
{
  // Vistas do Botanico - Cedros tem "16 3509 5858 / boletos01@condinvest.com.br"
  const r = verificar_cobranca_oficial({ condominio: "Vistas do Botanico", quem: "(16) 3509-5858" });
  check(r.status === "confere", `telefone oficial confere apesar da formatação, veio ${r.status}`);
}

console.log(`test_cobrador_oficial: ${ok}/${total} OK`);
