// test_boleto_sem_janela.mjs — determinístico, sem LLM, sem rede.
// Guarda do ponto cego real (caso Vanessa, 23/07): boleto vencido há ~3 meses NÃO aparece em
// cobranca/index?status=pendentes (só os recentes) → get_boleto_2via caía em "nenhum boleto
// pendente" e a Ana respondia "não localizou na emissão automática", que a moradora leu como
// "não devo nada" — quando na verdade estava inadimplente. A função pura decidirSemBoleto cruza
// com get_inadimplencia e devolve a mensagem CERTA, sem afirmar quitação e sem dizer "jurídico".
import assert from "node:assert";
import { decidirSemBoleto } from "../src/superlogica.mjs";

let ok = 0, total = 0;
const check = (c, m) => { total++; assert(c, m); ok++; };

// 1) Tem dívida velha (fora da janela de 30d) → motivo próprio + encaminha à cobrança, NUNCA "não localizado"
{
  const r = decidirSemBoleto({ status: "inadimplente", qtd_cobrancas_em_aberto: 4 });
  check(r.liberado === false, "inadimplente: não libera 2ª via");
  check(r.motivo === "debito_fora_da_janela_30d", `motivo esperado, veio ${r.motivo}`);
  check(r.qtd_cobrancas_em_aberto === 4, "propaga qtd de cobranças em aberto");
  check(/30 dias/i.test(r.mensagem_morador), "mensagem cita a régua de 30 dias");
  check(/cobran/i.test(r.mensagem_morador), "mensagem encaminha à cobrança");
  check(!/n[ãa]o localiz/i.test(r.mensagem_morador), "mensagem NÃO diz 'não localizado'");
  check(!/em dia|quitad/i.test(r.mensagem_morador), "mensagem NÃO afirma que está em dia/quitado");
}

// 2) Inadimplente E jurídico → ainda encaminha à cobrança, mas a mensagem ao morador NÃO diz "jurídico"
{
  const r = decidirSemBoleto({ status: "inadimplente", qtd_cobrancas_em_aberto: 2, no_juridico: true, qtd_processos: 1 });
  check(r.liberado === false, "jurídico: não libera");
  check(r.no_juridico === true, "propaga no_juridico p/ o roteamento interno (time)");
  check(!/jur[íi]dic|judicial|processo/i.test(r.mensagem_morador), "mensagem ao morador NÃO menciona jurídico/processo");
}

// 3) Realmente sem débito → mensagem NEUTRA, sem cravar "está em dia" (a 2ª via só vê a régua de 30d)
{
  const r = decidirSemBoleto({ status: "sem_debito_vencido" });
  check(r.liberado === false, "sem débito: também não há 2ª via a entregar");
  check(r.motivo === "sem_boleto_na_janela", `motivo esperado, veio ${r.motivo}`);
  check(!/em dia|quitad|nada (a|para) (pagar|dever)/i.test(r.mensagem_morador), "não afirma quitação");
  check(/mês|competência|esperava|verific/i.test(r.mensagem_morador), "convida a informar o mês/competência");
}

// 4) Consulta indisponível → não crava adimplência; mensagem neutra (mesmo motivo neutro)
{
  const r = decidirSemBoleto({ status: "indisponivel" });
  check(r.liberado === false, "indisponível: não libera");
  check(!/em dia|quitad/i.test(r.mensagem_morador), "indisponível: não afirma que está em dia");
}

// 5) Garantido por garantidora → direciona à garantidora (defensivo; o get_boleto_2via já corta 'total' antes)
{
  const r = decidirSemBoleto({ status: "gerido_por_garantidora", garantidora: { nome: "Total Garantidora" } });
  check(r.liberado === false, "garantidora: não libera");
  check(r.motivo === "garantidora", `motivo garantidora, veio ${r.motivo}`);
  check(r.garantidora && r.garantidora.nome === "Total Garantidora", "propaga a garantidora");
}

// 6) Entrada nula/indefinida (get_inadimplencia falhou por completo) → neutro, nunca "em dia"
{
  const r = decidirSemBoleto(null);
  check(r.liberado === false, "null: não libera");
  check(!/em dia|quitad/i.test(r.mensagem_morador || ""), "null: não afirma quitação");
}

console.log(`test_boleto_sem_janela: ${ok}/${total} OK`);
