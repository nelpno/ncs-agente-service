// test_inadimplencia_detalhe.mjs — determinístico, sem LLM, sem rede.
// Hoje a Ana sabe QUANTAS cobranças estão em aberto ("constam 3") e não sabe QUAIS — o morador
// pergunta "quais meses?" e ela precisa passar para a equipe. O `inadimplencia/index` SEM
// `apenasResumoInad` já devolve `recebimento[]` itemizado (sondado ao vivo 07/08): dt_vencimento_recb,
// vl_total_recb, id_acordo_recb, id_processo_proc.
//
// 🔴 A trava principal: NUNCA sair um "total a pagar". Os valores da API são os ORIGINAIS, sem juros,
// multa e honorários — que variam por condomínio (1%/2%/10%) e são calculados pela cobrança. Um número
// dito à pessoa como "é isso que você deve" seria menor que o real, e ela pagaria achando que quitou.
// Por isso o campo se chama `total_original` e vem com `nota_valor` explicando.
//
// ⚠️ Datas em MM/DD/AAAA: "05/18/2026" é 18 de MAIO.
import assert from "node:assert";
import { resumirCobrancasEmAberto } from "../src/superlogica.mjs";

let ok = 0, total = 0;
const check = (c, m) => { total++; assert(c, m); ok++; };
const HOJE = new Date("2026-08-07T12:00:00Z");

const REC = [
  { dt_vencimento_recb: "05/18/2026 00:00:00", vl_total_recb: "354.94", st_label_recb: "Taxa condominial" },
  { dt_vencimento_recb: "06/18/2026 00:00:00", vl_total_recb: "354.94", st_label_recb: "Taxa condominial" },
  { dt_vencimento_recb: "07/18/2026 00:00:00", vl_total_recb: "410.00", st_label_recb: "Taxa + extra", id_acordo_recb: "77" },
];

// ---------- 1) Lista itemizada, ordenada do mais antigo ----------
{
  const r = resumirCobrancasEmAberto(REC, HOJE);
  check(r.qtd === 3, `3 cobranças, veio ${r.qtd}`);
  check(r.cobrancas.length === 3, "devolve as 3 itemizadas");
  check(r.cobrancas[0].vencimento === "18/05/2026", `1ª é a mais antiga em DD/MM/AAAA, veio ${r.cobrancas[0].vencimento}`);
  check(r.cobrancas[2].vencimento === "18/07/2026", "última é a mais recente");
  check(r.cobrancas[0].dias_vencido === 81, `18/05 → 81 dias, veio ${r.cobrancas[0].dias_vencido}`);
  check(r.cobrancas[2].em_acordo === true, "marca a que está em acordo");
  check(r.cobrancas[0].em_acordo === false, "e não marca as outras");
}

// ---------- 2) 🔴 total_original NUNCA se apresenta como valor a pagar ----------
{
  const r = resumirCobrancasEmAberto(REC, HOJE);
  check(Math.abs(r.total_original - 1119.88) < 0.01, `soma os originais, veio ${r.total_original}`);
  check(typeof r.nota_valor === "string" && r.nota_valor.length > 0, "acompanha nota sobre o valor");
  check(/juros|multa/i.test(r.nota_valor), "a nota diz que faltam juros/multa");
  check(!/total a pagar|valor a pagar|voc[êe] deve/i.test(r.nota_valor), "a nota NÃO chama de total a pagar");
  check(r.total_a_pagar === undefined, "🔴 não existe campo total_a_pagar");
}

// ---------- 3) Processo judicial marcado no item (roteamento interno) ----------
{
  const r = resumirCobrancasEmAberto([{ ...REC[0], id_processo_proc: "912" }], HOJE);
  check(r.cobrancas[0].no_juridico === true, "item com id_processo_proc marca no_juridico");
  check(r.tem_juridico === true, "e o resumo também");
}

// ---------- 4) Entradas degeneradas não viram lista fantasma ----------
{
  for (const vazio of [[], null, undefined, "x", {}]) {
    const r = resumirCobrancasEmAberto(vazio, HOJE);
    check(r.qtd === 0 && r.cobrancas.length === 0, `entrada ${JSON.stringify(vazio)} → lista vazia`);
    check(r.total_original === 0, "e total zero");
  }
}

// ---------- 5) Valor mal formado não vira NaN silencioso na soma ----------
{
  const r = resumirCobrancasEmAberto([{ dt_vencimento_recb: "05/18/2026 00:00:00", vl_total_recb: "" },
                                      { dt_vencimento_recb: "06/18/2026 00:00:00", vl_total_recb: "100.00" }], HOJE);
  check(r.total_original === 100, `ignora o valor vazio na soma, veio ${r.total_original}`);
  check(r.cobrancas[0].valor === null, "e expõe o valor ausente como null, não como 0");
}

// ---------- 6) Teto de itens: quem deve 40 meses não recebe 40 linhas no WhatsApp ----------
{
  const muitos = Array.from({ length: 40 }, (_, i) => ({ dt_vencimento_recb: `01/${String((i % 28) + 1).padStart(2, "0")}/2026 00:00:00`, vl_total_recb: "100.00" }));
  const r = resumirCobrancasEmAberto(muitos, HOJE);
  check(r.qtd === 40, "conta todas");
  check(r.cobrancas.length === 12, `lista no máximo 12, veio ${r.cobrancas.length}`);
  check(r.truncado === true, "e AVISA que truncou (corte silencioso vira 'são só 12')");
  check(Math.abs(r.total_original - 4000) < 0.01, "o total soma TODAS, não só as listadas");
}

// ---------- 7) O guard do jurídico está escrito no get_inadimplencia, não aqui ----------
// Smoke ao vivo (07/08) achou uma unidade com 56 cobranças desde 2024 E processo judicial: listar
// débito de unidade em litígio é self-service em assunto judicial, que a casa não faz. O código só
// anexa `detalhe` quando `!no_juridico` — este teste guarda a CONDIÇÃO no fonte para que ninguém a
// remova por engano (a função pura acima não tem como saber do processo da unidade).
{
  const fs = await import("node:fs");
  const url = new URL("../src/superlogica.mjs", import.meta.url);
  const src = fs.readFileSync(url, "utf8");
  check(/if\s*\(detalhar\s*&&\s*!r\.no_juridico\)/.test(src), "get_inadimplencia só detalha quando NÃO há processo judicial");
}

console.log(`test_inadimplencia_detalhe: ${ok}/${total} OK`);
