// test_boleto_mes.mjs — determinístico, sem LLM, sem rede.
// Buraco medido no uso REAL (06/08, conv 658, Allure Bl 13/401): a moradora precisava do boleto
// DE JULHO para abrir um sinistro; a Ana só entrega o que está em aberto AGORA e a equipe teve
// de mandar à mão. Sondado ao vivo (07/08): `cobranca/index` sem data devolve SÓ o mês corrente,
// nem com status=todos; com `filtrarpor=vencimento&dtInicio&dtFim` alcança qualquer mês
// (julho: 717 itens, 309 já pagos, link em 717/717).
//
// 🔴 A trava que estes testes existem para guardar: boleto JÁ PAGO não pode sair como "2ª via
// para pagamento". O morador pediria o documento e receberia um PIX — pagando duas vezes.
// Sai o link (o documento serve ao sinistro/comprovante) e NUNCA o PIX.
//
// ⚠️ Datas da API em MM/DD/AAAA. "07/03/2026" é 3 de JULHO, não 7 de março — errar isso
// devolve o mês errado calado (mordeu na 1ª versão da sonda).
import assert from "node:assert";
import { janelaDoMes, classificarBoletoDoMes } from "../src/superlogica.mjs";

let ok = 0, total = 0;
const check = (c, m) => { total++; assert(c, m); ok++; };

// ---------- janelaDoMes: monta dtInicio/dtFim em MM/DD/AAAA ----------
{
  const j = janelaDoMes("2026-07");
  check(j && j.dtInicio === "07/01/2026", `dtInicio julho, veio ${j && j.dtInicio}`);
  check(j && j.dtFim === "07/31/2026", `dtFim julho (31 dias), veio ${j && j.dtFim}`);
}
{
  const j = janelaDoMes("07/2026"); // como a pessoa escreve
  check(j && j.dtInicio === "07/01/2026", "aceita MM/AAAA");
  check(j && j.dtFim === "07/31/2026", "aceita MM/AAAA (fim)");
}
{
  const j = janelaDoMes("2026-06");
  check(j && j.dtFim === "06/30/2026", `junho tem 30 dias, veio ${j && j.dtFim}`);
}
{
  const j = janelaDoMes("2026-02");
  check(j && j.dtFim === "02/28/2026", `fev/2026 tem 28, veio ${j && j.dtFim}`);
}
{
  const j = janelaDoMes("2028-02");
  check(j && j.dtFim === "02/29/2028", `fev/2028 é bissexto (29), veio ${j && j.dtFim}`);
}
{
  const j = janelaDoMes("2026-12");
  check(j && j.dtInicio === "12/01/2026" && j.dtFim === "12/31/2026", "dezembro fecha no 31");
}
// Lixo não vira janela silenciosa: mês inválido tem de ser null, senão consultaríamos
// um período errado e responderíamos "não há boleto nesse mês" para um mês que existe.
for (const ruim of ["2026-13", "2026-00", "julho", "", null, undefined, "26-07", "2026", 7]) {
  check(janelaDoMes(ruim) === null, `entrada inválida vira null: ${JSON.stringify(ruim)}`);
}

// ---------- classificarBoletoDoMes ----------
const HOJE = new Date("2026-08-07T12:00:00Z");

// 1) PAGO → é documento, não cobrança: sai o link, NUNCA o PIX
{
  const b = {
    dt_vencimento_recb: "07/03/2026 00:00:00",
    dt_liquidacao_recb: "07/02/2026 00:00:00",
    fl_status_recb: "3",
    st_pixqrcode_recb: "00020126580014BR.GOV.BCB.PIX-EMV-FALSO",
    link_segundavia: "https://exemplo/FaturaHtml-x",
    vl_total_recb: "450,00",
  };
  const r = classificarBoletoDoMes(b, HOJE);
  check(r.situacao === "pago", `situacao pago, veio ${r.situacao}`);
  check(r.liberado === true, "pago ainda entrega o documento (sinistro/comprovante)");
  check(r.dt_liquidacao_recb === "07/02/2026 00:00:00", "propaga a data do pagamento");
  check(!("st_pixqrcode_recb" in r) || r.st_pixqrcode_recb == null, "🔴 boleto PAGO não devolve PIX");
  check(r.link_segundavia === "https://exemplo/FaturaHtml-x", "pago devolve o link do documento");
}

// 2) EM ABERTO dentro dos 30 dias → 2ª via normal, com PIX
{
  const b = {
    dt_vencimento_recb: "08/03/2026 00:00:00",
    dt_liquidacao_recb: "",
    fl_status_recb: "1",
    st_pixqrcode_recb: "PIX-EMV",
    link_segundavia: "https://exemplo/FaturaHtml-y",
  };
  const r = classificarBoletoDoMes(b, HOJE);
  check(r.situacao === "em_aberto", `em_aberto, veio ${r.situacao}`);
  check(r.liberado === true, "em aberto e recente: libera");
  check(r.st_pixqrcode_recb === "PIX-EMV", "em aberto devolve o PIX");
  check(r.dias_vencido === 4, `4 dias vencido, veio ${r.dias_vencido}`);
}

// 3) EM ABERTO vencido +30d → NÃO libera; é dívida, vai para a cobrança (guard que já existia)
{
  const b = {
    dt_vencimento_recb: "06/01/2026 00:00:00",
    dt_liquidacao_recb: "",
    fl_status_recb: "1",
    st_pixqrcode_recb: "PIX-EMV",
    link_segundavia: "https://exemplo/FaturaHtml-z",
  };
  const r = classificarBoletoDoMes(b, HOJE);
  check(r.situacao === "vencido_30d", `vencido_30d, veio ${r.situacao}`);
  check(r.liberado === false, "🔴 dívida antiga não sai por self-service");
  check(r.st_pixqrcode_recb == null, "vencido +30d não devolve PIX");
  check(r.dias_vencido > 30, "informa os dias para o roteamento à cobrança");
}

// 4) A DATA É MM/DD — o guard que evita ler mês pelo dia.
// "12/07/2026" é 7 de DEZEMBRO (futuro em relação a hoje/agosto), não 12 de julho.
{
  const b = { dt_vencimento_recb: "12/07/2026 00:00:00", dt_liquidacao_recb: "", fl_status_recb: "1", link_segundavia: "u" };
  const r = classificarBoletoDoMes(b, HOJE);
  check(r.situacao === "em_aberto", `dezembro ainda não venceu, veio ${r.situacao}`);
  check(r.dias_vencido <= 0, `a vencer tem dias_vencido <= 0, veio ${r.dias_vencido}`);
}

// 5) Sem data de vencimento não vira "pago" nem "a vencer" por acidente
{
  const r = classificarBoletoDoMes({ dt_vencimento_recb: "", dt_liquidacao_recb: "", link_segundavia: "u" }, HOJE);
  check(r.situacao === "em_aberto" && r.dias_vencido === 0, "sem data: trata como em aberto, 0 dias");
}

// 6) fl_status_recb=3 sem dt_liquidacao ainda conta como pago (a baixa é o que importa,
//    mas o status do ERP não pode ser ignorado — os dois sinais valem)
{
  const r = classificarBoletoDoMes({ dt_vencimento_recb: "07/03/2026 00:00:00", dt_liquidacao_recb: "", fl_status_recb: "3", st_pixqrcode_recb: "P", link_segundavia: "u" }, HOJE);
  check(r.situacao === "pago", "fl_status_recb=3 também marca pago");
  check(r.st_pixqrcode_recb == null, "e continua sem PIX");
}

console.log(`test_boleto_mes: ${ok}/${total} OK`);
