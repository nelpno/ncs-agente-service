// test_regimento_cobranca.mjs — o vão de vocabulário do domínio financeiro (achado no uso real de 14/07).
// A recepcionista perguntou "Como funciona as cobranças de inadimplentes… Abbocato?" e o robô respondeu
// que "não apareceu trecho específico com percentual de multa ou juros" — com a Convenção Art. 29º
// ("os condôminos EM ATRASO … pagarão MULTA DE 2%") na base. O artigo não contém "inadimplente" nem
// "cobrança": o vão é de vocabulário (palavra do morador × palavra jurídica), por isso vive no SYN.
import assert from "node:assert";
import { consultar_regimento } from "../src/regimento.mjs";
let ok = 0;

// 1) PROVA QUE FUNCIONOU — o jeito natural de perguntar tem que trazer o artigo que responde.
{
  const perguntas = [
    "cobrança de inadimplentes",
    "como funciona a cobrança de inadimplentes",
    "cobrança extrajudicial",
    "multa e juros por atraso no pagamento",
    "qual a multa por atraso",
  ];
  for (const p of perguntas) {
    const r = await consultar_regimento({ condominio: "spazio abbocato", pergunta: p });
    assert.ok(r.encontrou, `"${p}" não encontrou nada`);
    assert.ok(
      r.trechos.some((t) => /Art\.?\s*29/i.test(t.fonte) && /multa de 2|2%/i.test(t.texto)),
      `"${p}" → Art. 29º (multa de 2%) ausente nos trechos: ${r.trechos.map((t) => t.fonte).join(", ")}`
    );
  }
  ok++;
}

// 2) PROVA QUE NÃO AFROUXOU — controle: o Allure NÃO tem horário de reforma no documento
//    (grep na fonte: "reforma" só aparece em contexto de orçamento). Se um dia isto "achar" o
//    horário, o sinônimo afrouxou e o robô vai citar trecho irrelevante como se fosse a regra.
//    ⚠️ Só atualize este teste conscientemente, se o Allure for re-ingerido com regra nova de reforma.
{
  const r = await consultar_regimento({ condominio: "allure", pergunta: "horário permitido para reforma" });
  const txt = JSON.stringify(r.trechos || []);
  assert.ok(
    !/reforma[^"]{0,60}\b(das|entre|a partir)\b[^"]{0,20}\d{1,2}\s*(h|horas)/i.test(txt),
    "controle: apareceu horário de reforma no Allure — o retriever afrouxou"
  );
  ok++;
}

// 3) O termo do morador não pode sequestrar assunto de outro domínio (ex.: "multa" já existia no SYN
//    ligada a penalidade/advertência — a adição financeira não pode quebrar o uso disciplinar).
{
  const r = await consultar_regimento({ condominio: "spazio abbocato", pergunta: "multa por barulho" });
  assert.ok(r.encontrou, "multa por barulho deveria achar algo");
  ok++;
}

console.log(`test_regimento_cobranca: ${ok}/3 grupos OK`);
