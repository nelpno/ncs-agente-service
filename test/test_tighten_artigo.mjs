// test_tighten_artigo.mjs — re-fatiamento do texto_artigo do catálogo (RI/Convenção) para citar SÓ a regra
// da conduta. Feedback Fernando 24/07 ("busca muito ampla") + revisão de desenho com Fable 5.
// A saída é VERBATIM: blocos literais da FONTE unidos por "(...)"; caso ambíguo → {revisar} mantendo o texto
// atual (nunca piora). Determinístico e hermético (fonte injetada, sem rede).
import assert from "node:assert";
import { tightenArtigo, stripFooters } from "../gerador/src/tighten-artigo.mjs";

let ok = 0, total = 0;
const falhas = [];
// acumula (em vez de abortar na 1ª): com 14 cenários, ver TODAS as falhas de uma vez vale mais.
const check = (c, m) => { total++; if (c) ok++; else falhas.push(m); };
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

// ── 8) FIX A — item com hífen/barra: a fonte tokeniza "aluga-las"→"alugalas" e a frase-alvo precisa casar
//      pelo MESMO caminho (senão NENHUM item com hífen é localizável). Caso real: barbieri, monet. ──
{
  const fonte = "Art. 9 - São deveres dos condôminos: a) Não usar as respectivas unidades autônomas, nem aluga-las ou cede-las para atividades ruidosas; b) Não remover pó de tapetes, cortinas, etc, senão por meios que impeçam a sua dispersão; c) Não estender roupas.";
  const atual = "a) Não usar as respectivas unidades autônomas, nem aluga-las ou cede-las para atividades ruidosas; b) Não remover pó de tapetes, cortinas, etc, senão por meios que impeçam a sua dispersão; c)";
  const r = tightenArtigo(atual, fonte);
  check(!r.revisar, `item com hífen não foi localizado (motivo=${r.motivo})`);
  check(/aluga-las ou cede-las/.test(r.texto), `perdeu a regra do item a): ${r.texto}`);
  check(!/remover pó de tapetes/.test(r.texto), `arrastou o item b): ${r.texto}`);
  check(verbatimHonesto(r.texto, fonte), "verbatim honesto");
}

// ── 9) FIX B — ordinal do catálogo ("Art. 1º") x ordinal da fonte OCR ("Art. 1o"): comparação colapsa,
//      saída continua verbatim da fonte. Caso real: allure/dano_infiltracao. ──
{
  const fonte = "Capítulo XV - Da Indenização por Danos Causados\n\nArt. 1o - Todo e qualquer dano causado por Condôminos em qualquer área comum do Condomínio deverá ser inteiramente indenizado pelo Condômino implicado na ocorrência.";
  const atual = "Capítulo XV - Da Indenização por Danos Causados Art. 1º - Todo e qualquer dano causado por Condôminos em qualquer área comum do Condomínio deverá ser inteiramente indenizado pelo Condômino implicado na ocorrência.";
  const r = tightenArtigo(atual, fonte);
  check(!r.revisar, `ordinal º/o impediu a localização (motivo=${r.motivo})`);
  check(/dano causado por Condôminos/.test(r.texto), "manteve a regra");
}

// ── 10) FIX C — idempotência de texto JÁ re-fatiado (contém "(...)"): valida bloco-a-bloco e não marca
//       revisar por falso alarme. Caso real: allure/lavar_veiculo, aristocrata/*. ──
{
  const fonte = "Art. 13 - Será expressamente proibido: f) Uso de buzina na garagem; g) Lavagem, pintura e lubrificação de veículos na garagem, inclusive se for para tirar neblina do pára-brisa; h) Consertos.";
  const jaJusto = "Art. 13 - Será expressamente proibido: (...) g) Lavagem, pintura e lubrificação de veículos na garagem, inclusive se for para tirar neblina do pára-brisa;";
  const r = tightenArtigo(jaJusto, fonte);
  check(!r.revisar, `texto já justo foi marcado revisar (motivo=${r.motivo})`);
  check(!r.changed, `texto já justo não deveria mudar: ${r.texto}`);
  check(/Lavagem, pintura/.test(r.texto) && !/Consertos/.test(r.texto), "preservou o recorte anterior");
  // e um "(...)" MENTIROSO (bloco que não existe na fonte) tem de cair em revisar
  const mentira = "Art. 13 - Será expressamente proibido: (...) z) Fumar dentro do elevador social do bloco B;";
  const rm = tightenArtigo(mentira, fonte);
  check(rm.revisar, "bloco inexistente na fonte tem de virar revisar");
}

// ── 11) FIX D — item longo: a caminhada para trás precisa atravessar itens de 250-400 chars até a cabeça
//       da lista. Caso real: alto-da-boa-vista, dom-pedro, flores (itens ~300 chars). ──
{
  const it = (l, txt) => `${l}) ${txt} ${"palavra ".repeat(38)}fim do item ${l};`;
  const fonte = `Art. 51 - Ficam determinadas as seguintes proibições:\n\n${it("a", "Alugar para clubes de jogos")}\n\n${it("b", "Abandonar objetos nas áreas comuns")}\n\n${it("c", "Guardar explosivos")}\n\nd) Usar aparelhagem de som de maneira a incomodar os demais condôminos.\n\ne) Criar animais.`;
  const atual = "d) Usar aparelhagem de som de maneira a incomodar os demais condôminos. e) Criar animais.";
  const r = tightenArtigo(atual, fonte);
  check(!r.revisar, `caminhada não alcançou o caput através de itens longos (motivo=${r.motivo})`);
  check(/seguintes proibições/.test(r.texto), `não trouxe o caput: ${r.texto}`);
  check(/aparelhagem de som/.test(r.texto), "manteve a regra do item d)");
  check(!/Criar animais|Alugar para clubes/.test(r.texto), `arrastou irmãos: ${r.texto}`);
  check(verbatimHonesto(r.texto, fonte), "verbatim honesto");
}

// ── 12) FIX E+G — lista NUMÉRICA com marcador sufixado ("6).-") e cabeça "A)= DAS PROIBIÇÕES...:".
//       O fim do item tem de ser o irmão do MESMO TIPO (7).-), não uma letra. Caso real: flores. ──
{
  const fonte = "ARTIGO 51°:- Para todos os efeitos, ficando determinada as seguintes proibições e deveres:\n\nA)= DAS PROIBIÇÕES AOS CONDÔMINOS:\n\n1).- Alugar, sublocar ou ceder a qualquer título qualquer apartamento para clubes de jogos de qualquer natureza.\n\n2).- Abandonar, depositar ou colocar quaisquer objetos nos lugares de uso comum do condomínio.\n\n3).- Estender, bater ou secar roupas, tapetes, toalhas, etc., nas janelas ou em outras áreas comuns.\n\n4).- Atirar papeis, pontas de cigarros e outros objetos nos corredores.";
  const atual = "3).- Estender, bater ou secar roupas, tapetes, toalhas, etc., nas janelas ou em outras áreas comuns. 4).-";
  const r = tightenArtigo(atual, fonte);
  check(!r.revisar, `lista numérica com sufixo ").-" não foi resolvida (motivo=${r.motivo})`);
  check(/PROIBIÇÕES AOS CONDÔMINOS/.test(r.texto), `não trouxe a cabeça deôntica: ${r.texto}`);
  check(/Estender, bater ou secar roupas/.test(r.texto), "manteve a regra");
  check(!/Atirar papeis|Abandonar, depositar/.test(r.texto), `arrastou irmãos numéricos: ${r.texto}`);
  check(verbatimHonesto(r.texto, fonte), "verbatim honesto");
}

// ── 13) FIX F — o irmão ANTERIOR é o próprio caput ("A) É proibido:"), curto e deôntico. Caso real:
//       dom-pedro (lista a)..h) precedida de "A) É proibido:"). Prefere o caput ESPECÍFICO ao genérico. ──
{
  const fonte = "### ARTIGO 51\n:- Para todos os efeitos, ficando determinada as seguintes proibições e deveres:\n\nA) É proibido:\n\na) Alugar qualquer apartamento para clubes de jogos de qualquer natureza.\n\nb) Abandonar objetos nos lugares de uso comum do edifício.\n\nc) Usar aparelhagem de som de maneira a incomodar os demais condôminos.\n\nd) Criar animais nas dependências do edifício.";
  const atual = "c) Usar aparelhagem de som de maneira a incomodar os demais condôminos. d) Criar animais nas dependências do edifício.";
  const r = tightenArtigo(atual, fonte);
  check(!r.revisar, `caput-irmão "A) É proibido:" não foi reconhecido (motivo=${r.motivo})`);
  check(/É proibido/.test(r.texto), `não trouxe o caput específico: ${r.texto}`);
  check(/aparelhagem de som/.test(r.texto) && !/Criar animais/.test(r.texto), `recorte errado: ${r.texto}`);
  check(verbatimHonesto(r.texto, fonte), "verbatim honesto");
}

// ── 14) ANTI-REGRESSÃO (o risco do FIX D): a caminhada NUNCA pode atravessar um rótulo estrutural e colar
//       o caput de OUTRO artigo/lista. Aqui a 2ª lista não tem caput deôntico → tem de virar revisar. ──
{
  const fonte = "Art. 10 - É expressamente proibido aos condôminos: a) fumar nas áreas comuns; b) usar bicicleta no hall.\n\nArt. 11 - O condomínio manterá os seguintes registros administrativos: a) livro de atas das assembleias; b) cadastro de moradores e veículos autorizados a circular.";
  const atual = "b) cadastro de moradores e veículos autorizados a circular.";
  const r = tightenArtigo(atual, fonte);
  check(!/expressamente proibido/.test(r.texto), `VAZOU o caput do artigo anterior (dano jurídico): ${r.texto}`);
  check(r.revisar || /registros administrativos/.test(r.texto), `deveria manter/registrar ambiguidade: ${JSON.stringify(r)}`);
}

// ── 15) o texto do catálogo pode começar UM ITEM ANTES da regra (extrator gravou a janela deslocada):
//       recortar o primeiro item citaria a regra ERRADA. Caso real: piemonte/menor_dirigindo, cujo texto
//       começa em "l) Instalação de cerca elétrica" mas a infração é o item "m) …menores… dirigir". ──
{
  const fonte = "Art. 14º É PROIBIDO: k) Soltar fogos; l) Instalação de cerca elétrica; m) Os menores de 18 anos ou pessoas sem habilitação para dirigir veículos automotores, de qualquer tamanho, classe ou tipo, no interior do loteamento; n) Atear fogo.";
  const atual = "l) Instalação de cerca elétrica; m) Os menores de 18 anos ou pessoas sem habilitação para dirigir veículos automotores, de qualquer tamanho, classe ou tipo, no interior do loteamento; n)";
  const meta = { titulo: "Menor Dirigindo Veículo", palavras_chave: ["menor dirigindo", "sem carteira", "veículo", "direção"] };
  const r = tightenArtigo(atual, fonte, meta);
  check(!/cerca elétrica/.test(r.texto) || r.revisar, `citou a regra ERRADA (cerca elétrica numa infração de direção): ${r.texto}`);
  check(r.revisar, `deveria sinalizar quando o 1º item não descreve a infração: ${JSON.stringify(r)}`);
  // sem meta, o comportamento antigo é preservado (nenhum chamador existente muda)
  const semMeta = tightenArtigo(atual, fonte);
  check(!semMeta.revisar, "sem meta, segue o comportamento anterior");
  // e quando o 1º item É o certo, a checagem não estorva
  const meta2 = { titulo: "Cerca Elétrica Irregular", palavras_chave: ["cerca", "elétrica", "instalação"] };
  const r2 = tightenArtigo(atual, fonte, meta2);
  check(!r2.revisar && /cerca elétrica/.test(r2.texto), `item correto foi barrado: ${JSON.stringify(r2)}`);
  check(!/menores de 18/.test(r2.texto), `arrastou o item seguinte: ${r2.texto}`);
}

if (falhas.length) {
  for (const f of falhas) console.error(`  ✗ ${f}`);
  assert.fail(`test_tighten_artigo: ${falhas.length} de ${total} falharam`);
}
console.log(`test_tighten_artigo: ${ok}/${total} OK`);
