// test_tighten_artigo.mjs — re-fatiamento do texto_artigo do catálogo (RI/Convenção) para citar SÓ a regra
// da conduta. Feedback Fernando 24/07 ("busca muito ampla") + revisão de desenho com Fable 5.
// A saída é VERBATIM: blocos literais da FONTE unidos por "(...)"; caso ambíguo → {revisar} mantendo o texto
// atual (nunca piora). Determinístico e hermético (fonte injetada, sem rede).
import assert from "node:assert";
import { tightenArtigo, stripFooters } from "../gerador/src/tighten-artigo.mjs";

let ok = 0, total = 0;
const check = (c, m) => { total++; assert(c, m); ok++; };
// verbatim honesto: cada bloco (separado por "(...)") existe literalmente na fonte (comparação normalizada)
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "").replace(/[^a-z0-9]+/g, " ").trim();
const verbatimHonesto = (out, fonte) => {
  const nf = norm(fonte);
  return out.split(/\s*\(\.\.\.\)\s*/).filter(Boolean).every((bloco) => nf.includes(norm(bloco)));
};

// ── 1) RODAPÉ: pré-passe remove rodapé de página (repetido + forma), inclusive colado no fim da linha ──
{
  const fonte = [
    // rodapé em linha própria (quebra de página) 3x → aprendido → depois removido inclusive quando COLADO
    "Art. 3º - É terminantemente proibida a colocação de sacos de lixo ou volumes nas portas dos apartamentos.",
    "Allure Condomínio Resort Rua Maurício Galli, 1215 - Araraquara – SP",
    "Revisão Regulamento Interno",
    "0 Data 19/09/2011 Página 6 de 15",
    "Art. 4º - Outra regra qualquer aqui.",
    "Allure Condomínio Resort Rua Maurício Galli, 1215 - Araraquara – SP",
    "Revisão Regulamento Interno",
    "0 Data 19/09/2011 Página 7 de 15",
    "Art. 5º - Mais uma regra.",
    "Allure Condomínio Resort Rua Maurício Galli, 1215 - Araraquara – SP",
    "Revisão Regulamento Interno",
    "0 Data 19/09/2011 Página 8 de 15",
  ].join("\n");
  const limpa = stripFooters(fonte);
  check(!/Maur[íi]cio Galli|Página \d+ de|Revisão Regulamento/.test(limpa), `rodapé sobrou na fonte limpa: ${limpa}`);
  check(/colocação de sacos de lixo/.test(limpa) && /Outra regra qualquer/.test(limpa), "regras legítimas têm de sobreviver ao pré-passe");

  const atual = "Art. 3º - É terminantemente proibida a colocação de sacos de lixo ou volumes nas portas dos apartamentos. Allure Condomínio Resort Rua Maurício Galli, 1215 - Araraquara – SP";
  const r = tightenArtigo(atual, fonte);
  check(!/Maur[íi]cio Galli|Página \d+ de/.test(r.texto), `rodapé vazou no texto: ${r.texto}`);
  check(/para|apartamentos/.test(r.texto), "manteve a regra");
  check(verbatimHonesto(r.texto, fonte), "verbatim honesto (blocos literais da fonte)");
}

// ── 2) ITEM-MODE: âncora dentro de item → caput + "(...)" + item; sem itens-irmãos ──
{
  const fonte = "Art. 13 - Na garagem é terminantemente proibido: g) Lavagem, pintura e lubrificação de veículos na garagem, inclusive se for para tirar neblina do pára-brisa; h) Consertos e reparos dos veículos na garagem; i) Locação ou comodato de vagas.";
  const atual = "horário. g) Lavagem, pintura e lubrificação de veículos na garagem, inclusive se for para tirar neblina do pára-brisa; h) Consertos e reparos dos veículos na garagem; i) Locação ou comodato de vagas.";
  const r = tightenArtigo(atual, fonte);
  check(/Lavagem, pintura e lubrificação de ve[íi]culos na garagem/.test(r.texto), "manteve a regra do item g)");
  check(/proibido/i.test(r.texto), "incluiu o CAPUT (o verbo que proíbe)");
  check(!/Consertos e reparos|Locação ou comodato/.test(r.texto), `arrastou irmãos: ${r.texto}`);
  check(!/^horário\./.test(r.texto.trim()), "não começa no fim da frase anterior");
  check(/\(\.\.\.\)/.test(r.texto), "supressão de itens marcada com (...)");
  check(verbatimHonesto(r.texto, fonte), "verbatim honesto");
}

// ── 3) EXCEÇÃO no bloco seguinte: NUNCA citar proibição absoluta quando há ressalva ──
{
  const fonte = "Art. 20 - É vedado aos condôminos: a) Utilizar churrasqueira nas varandas após as 22 horas; b) Excetuam-se as datas festivas previamente autorizadas pelo síndico.";
  const atual = "a) Utilizar churrasqueira nas varandas após as 22 horas; b) Excetuam-se as datas festivas previamente autorizadas pelo síndico.";
  const r = tightenArtigo(atual, fonte);
  // ou anexa a exceção, ou marca revisar — o que NÃO pode é cair na proibição absoluta sozinha
  const citouExcecao = /Excetuam-se|autorizadas pelo síndico/.test(r.texto);
  check(citouExcecao || r.revisar, `exceção sumiu sem flag: ${JSON.stringify(r)}`);
  if (!r.revisar) check(verbatimHonesto(r.texto, fonte), "verbatim honesto");
}

// ── 4) NÃO over-trima artigo + Parágrafo Único da MESMA conduta (silêncio noturno) ──
{
  const fonte = "Capítulo VIII - Do Horário Art. 1º - No período entre 22:00 e 07:00 horas cumpre respeitar o silêncio noturno. Parágrafo Único: Guardar silêncio evitando ruídos com furadeiras, martelos e etc. Capítulo IX - Da Coleta";
  const atual = "Capítulo VIII - Do Horário Art. 1º - No período entre 22:00 e 07:00 horas cumpre respeitar o silêncio noturno. Parágrafo Único: Guardar silêncio evitando ruídos com furadeiras, martelos e etc.";
  const r = tightenArtigo(atual, fonte);
  check(/silêncio noturno/.test(r.texto) && /Parágrafo Único/.test(r.texto), "mantém artigo + parágrafo único");
  check(/furadeiras, martelos/.test(r.texto), "não corta o parágrafo único que detalha a regra");
  check(!/Capítulo IX/.test(r.texto), "para antes do próximo capítulo");
}

// ── 5) ÂNCORA no caput (infração genérica) → mantém a lista inteira (não re-fatiar) ──
{
  const fonte = "Art. 13 - Na garagem é terminantemente proibido: a) estacionar fora da vaga; b) lavar veículos; c) fazer reparos.";
  const atual = "Art. 13 - Na garagem é terminantemente proibido: a) estacionar fora da vaga; b) lavar veículos; c) fazer reparos.";
  const r = tightenArtigo(atual, fonte);
  check(/estacionar fora da vaga/.test(r.texto) && /lavar veículos/.test(r.texto) && /fazer reparos/.test(r.texto),
    `âncora no caput deveria manter a lista inteira: ${r.texto}`);
}

// ── 6) idempotência: aplicar 2× não muda ──
{
  const fonte = "Art. 3º - É terminantemente proibida a colocação de sacos de lixo. Allure Condomínio Resort Rua Maurício Galli, 1215 - Araraquara – SP";
  const atual = fonte;
  const a = tightenArtigo(atual, fonte).texto;
  const b = tightenArtigo(a, fonte).texto;
  check(a === b, `não idempotente: "${a}" != "${b}"`);
}

// ── 7) fail-safe: âncora não localizável na fonte → mantém o texto atual + revisar ──
{
  const r = tightenArtigo("Texto que não existe na fonte nenhuma.", "Art. 1 - Fonte totalmente diferente.");
  check(r.revisar && /não existe na fonte/.test(r.texto), "não localizou → mantém atual + revisar");
}

console.log(`test_tighten_artigo: ${ok}/${total} OK`);
