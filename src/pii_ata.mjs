// pii_ata.mjs — tira CPF, RG e o nome de quem compôs a mesa do texto de ATA antes de o documento
// entrar no RAG.
//
// Ata de assembleia qualifica quem presidiu e quem secretariou com nome + RG + CPF + endereço.
// A unidade permanece (é dado do condomínio, não da pessoa) e o endereço do prédio também.
//
// ⚠️ Este mascarador tem de errar para o lado de PRESERVAR: valor em reais, percentual, data, CNPJ do
// condomínio, CEP, número de lei e de artigo são exatamente o conteúdo útil da ata. Um regex ganancioso
// de "sequência de dígitos com pontos" comeria R$ 101.893,87 e a Lei 4.591/64 junto com o CPF — e o
// resultado continuaria parecendo uma ata. Por isso cada padrão aqui é ancorado no RÓTULO (CPF/RG).
const MARCA = '[removido]';

// CPF: só quando vem anunciado como CPF. Aceita 000.000.000-00 e 00000000000.
const CPF_ROTULADO = /\bCPF\b([^0-9\n]{0,20})(\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11})/gi;
// RG: idem. O RG brasileiro varia muito (com/sem dígito verificador, com/sem pontos) — por isso o
// rótulo é obrigatório. O `\s*-\s*` no fim existe porque a ata do Vancouver traz "RG n° 8169562 -7",
// com espaço ANTES do hífen: sem isso o dígito verificador ficava órfão como " -7" depois do corte.
const RG_ROTULADO = /\bRG\b([^0-9\n]{0,20})(\d{1,3}(?:\.\d{3}){1,3}(?:\s*-\s*[0-9A-Za-z])?|\d{7,11}(?:\s*-\s*[0-9A-Za-z])?)/gi;

// ── nome de quem compôs a mesa ────────────────────────────────────────────────
// Decisão do Fernando (07/08/2026), tópico 2 do que ele aprovou: a ata no RAG entra "sem dado
// pessoal: CPF, quem participou, quem foi presidente da mesa". Até 08/08 este módulo tirava só
// documento e PRESERVAVA o nome de propósito — a política mudou, e o teste registra por quê.
//
// A âncora é LOCAL: o nome só sai quando está COLADO a um sinal de pessoa (tratamento, cargo da
// mesa ou qualificação por documento).
//
// 🔴 A 1ª versão desta regra varria toda LINHA que tivesse cargo + documento, e comeu pautas de
// deliberação inteiras nas atas escritas em CAIXA ALTA — "DELIBERAÇÃO E APROVAÇÃO DA PREVISÃO
// ORÇAMENTÁRIA", "E REAJUSTE DA TAXA CONDOMINIAL", "APROVAÇÃO E RATEIO COBERTURA PARA O GRILL" e o
// endereço do condomínio. Em várias atas o cabeçalho, a qualificação da mesa e as pautas estão
// TODOS na mesma linha, e ali "sequência de palavras maiúsculas" não distingue pessoa de pauta.
// Destruía justamente o que a ata serve para responder ("aumentou a taxa? foi decidido quando?").
const MARCA_NOME = '[nome removido]';
const semAcento = (s) => String(s).normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');

// 🔴 NUNCA usar a flag `i` nos regexes que contêm o TOKEN de nome. Em JavaScript, `i` + `u` faz
// case-folding e `\p{Lu}` passa a casar MINÚSCULA — o token deixa de exigir maiúscula e o "nome"
// engole a frase inteira. Foi exatamente isso que aconteceu ao acrescentar o lookbehind de
// logradouro: "O Sr. Alexandre esclareceu que a responsabilidade é de quem realizou a reserva"
// virou "O Sr. [nome removido] realizou a reserva" — o sentido INVERTEU (de regra geral para fato
// sobre uma pessoa) e nada acusou. Por isso a insensibilidade a caixa é escrita letra a letra.
const ci = (s) => s.replace(/[a-zA-ZÀ-ÿ]/g, (c) => `[${c.toUpperCase()}${c.toLowerCase()}]`);
const CARGO = `(?:${['PRESIDENTE', 'PRESIDENTA', 'SECRETÁRIO', 'SECRETÁRIA', 'SECRETARIO', 'SECRETARIA',
  'SÍNDICO', 'SÍNDICA', 'SINDICO', 'SINDICA', 'SUBSÍNDICO', 'SUBSÍNDICA', 'SUBSINDICO', 'SUBSINDICA',
  'CONSELHEIRO', 'CONSELHEIRA'].map(ci).join('|')})`;
// ⚠️ "portador/inscrito" NÃO entra aqui. Na ata a qualificação vem longe do nome — "VIVIANE
// APARECIDA CEREDA FERREIRA, brasileira, casada, Pedagoga Coordenadora Técnica da Secretaria
// Municipal da Educação, portadora do RG…" — então a âncora pegava as duas palavras imediatamente
// antes de "portadora" e apagava "Municipal da Educação", deixando o NOME REAL intacto. Pior dos
// dois mundos: perde conteúdo e não protege ninguém. Só rótulo de documento, que é imediato.
// ⚠️ Fronteira de palavra obrigatória: sem ela "RG" casa DENTRO de "CA-RG-OS" e a frase
// "OS OUTROS CARGOS FICARAM EM VACÂNCIA" virava "[nome removido]RGOS FICARAM EM VACÂNCIA".
const DOC = '(?:\\bCPF\\b|\\bRG\\b|\\[removido\\])';
// nome próprio = 2+ tokens capitalizados seguidos (de/da/do/dos/das/e no meio não contam como token).
// ⚠️ O lookahead que barra CPF/RG/cargo é o que faz a coisa funcionar no formato real do Studio Five,
// "LUCAS VICENTE REIS CPF: … PRESIDENTE": sem ele o quantificador guloso engolia o próprio "CPF"
// dentro do nome, a lista ESTRUTURAL via "cpf" ali e concluía que não era pessoa — o documento saía
// e o nome ficava, que é o pior dos dois mundos e passava despercebido.
// ⚠️ Sem ponto no corpo do token: com ele, "Sr. José Aparecido de Oliveira. Passando para o item 4"
// virava um "nome" que atravessava o fim da frase, e a substituição levava junto o começo da frase
// seguinte. O preço é perder o ponto de abreviações no meio do nome — irrelevante, já que o nome sai.
const TOKEN = `(?!CPF\\b|RG\\b|Cpf\\b|Rg\\b|${CARGO})\\p{Lu}[\\p{L}'’-]*`;
// ⚠️ Espaço e tab, NUNCA \s: \s casa quebra de linha, e aí o "nome" atravessava o fim do parágrafo
// e a substituição COLAPSAVA as duas linhas numa só (media 8 das 25 atas). Nome não muda de linha.
const NOME = `${TOKEN}(?:[ \\t]+(?:(?:de|da|do|dos|das|e)[ \\t]+)?${TOKEN}){1,6}`;

// A) tratamento antes do nome — "Sr. ANGELO RODRIGUES GOLDONI", "Srta. Naiara Affonso Amancio"
// ⚠️ O lookbehind de logradouro existe porque "Avenida Dr. Leite de Moraes, 951" é o ENDEREÇO do
// condomínio no cabeçalho de toda ata do Vida Plena — e o "Dr." ali é do nome da rua, não de pessoa.
const LOGRADOURO = ['avenida', 'av', 'rua', 'r', 'alameda', 'praça', 'praca', 'travessa', 'rodovia', 'estrada', 'rod'].map(ci).join('|');
const TRATAMENTO = ['Sr', 'Sra', 'Srta', 'Dr', 'Dra'].map(ci).join('|');
const A_TRATAMENTO = new RegExp(
  `(?<!\\b(?:${LOGRADOURO})\\.?[ \\t])\\b(${TRATAMENTO})\\.?[ \\t]+(${NOME})`, 'gu');
// B) linha de ASSINATURA: nome no início da linha seguido do cargo — "**ALEXANDRE FERRARI** — PRESIDENTE"
// ⚠️ A âncora de início de linha (^) não é decoração: sem ela esta regra casava "ITEM 3 – ELEIÇÃO DE
// Síndico, Subsíndico e Membros do Conselho" e transformava a PAUTA DA ELEIÇÃO em "[nome removido]".
// Os outros formatos de assinatura ("NOME CPF: … PRESIDENTE") já são cobertos pelo C_DOC.
const B_CARGO = new RegExp(`^([ \\t]*\\*{0,2})(${NOME})(\\*{0,2}[ \\t]*[—–\\-:,][ \\t]*\\*{0,2}${CARGO})`, 'gmu');
// C) nome seguido da qualificação — "NATANAEL OLIVEIRA DE SOUZA SOARES: [removido] RG:"
const C_DOC = new RegExp(`(${NOME})(\\*{0,2}[ \\t]*[:,]?[ \\t]*(?:${DOC}))`, 'gu');
// E) CARGO seguido de dois-pontos e o nome — é assim que a ata registra quem foi eleito:
// "1º CONSELHEIRA FISCAL SUPLENTE: VIVIANE APARECIDA CEREDA FERREIRA, brasileira, casada…".
// Sem esta âncora esse nome ficava, porque não tem tratamento ("Sra.") nem documento colado.
// O miolo aceita só MAIÚSCULAS e espaço até os dois-pontos: assim casa " FISCAL SUPLENTE" e não
// casa "ITEM 3 – ELEIÇÃO DE Síndico, Subsíndico e Membros do Conselho:", que tem vírgulas e
// minúsculas e é PAUTA, não eleição registrada.
const E_CARGO_DOIS_PONTOS = new RegExp(`(${CARGO}[A-ZÁÂÃÀÉÊÍÓÔÕÚÜÇ \\t]{0,25}:[ \\t]*)(${NOME})`, 'gu');

// Se a sequência carrega uma destas, não é pessoa — é a entidade, o cargo, o endereço ou a pauta.
const ESTRUTURAL = /condominio|residencial|edificio|associacao|assembleia|geral|ordinaria|extraordinaria|instalacao|presiden|secretari|sindic|conselho|\bata\b|cpf|\brg\b|\brua\b|\bav\b|avenida|alameda|\bpraca\b|travessa|rodovia|estrada|\brod\b|\bvila\b|\bjardim\b|\bbairro\b|\bcep\b|delibera|aprova|presta|previsao|orcament|taxa|reajuste|rateio|\bitem\b|assunto|relatorio|convenc|regimento|eleica|eleicao|eleger|vacancia|\bcargo|energia|ligacao|interesse|economista|socio\b|\bgrupo\b|\bncs\b|administradora|imobiliaria|construtora|incorporadora|\bempresa|ltda|\bbanco\b|\bs\.?a\.?\b/i;

const ehPessoa = (s) => !ESTRUTURAL.test(semAcento(s));
const trocaSeForPessoa = (nome) => (ehPessoa(nome) ? MARCA_NOME : nome);

// D) BLOCO DE ASSINATURA MULTILINHA — o formato em que o Drive entrega as atas do lote de 2026:
//      José Francisco Freitas Caires
//      CPF: 074.795.548-42
//      RG: 18.819.389
//      Presidente
// Nenhuma das âncoras acima pega isto (todas exigem nome e sinal na MESMA linha), e sem D o lote
// inteiro entraria com o nome da mesa. A âncora é: a linha inteira é só um nome próprio, e uma das
// próximas linhas não-vazias começa com CPF/RG. O `RODAPE` existe porque o extrator gruda a
// numeração de página no começo da linha ("4 | Página Luciana Somenzari de Almeida").
const RODAPE = /^\s*\d+\s*\|\s*P[áa]gina\s*/i;
const SO_NOME = new RegExp(`^(${NOME})[ \\t]*[.,;]?$`, 'u');
const ABRE_DOC = /^\s*(?:CPF|RG)\b/i;
const JANELA_ASSINATURA = 4;

function mascararAssinaturaMultilinha(texto) {
  const linhas = String(texto).split('\n');
  return linhas.map((linha, i) => {
    const prefixo = (linha.match(RODAPE) || [''])[0];
    const corpo = linha.slice(prefixo.length);
    const m = corpo.match(SO_NOME);
    if (!m || !ehPessoa(m[1])) return linha;
    // olha as próximas linhas não-vazias em busca de um rótulo de documento
    let vistas = 0;
    for (let j = i + 1; j < linhas.length && vistas < JANELA_ASSINATURA; j++) {
      if (!linhas[j].trim()) continue;
      vistas++;
      if (ABRE_DOC.test(linhas[j])) return prefixo + corpo.replace(m[1], MARCA_NOME);
    }
    return linha;
  }).join('\n');
}

function mascararNomesDaMesa(texto) {
  return mascararAssinaturaMultilinha(
    String(texto)
      .replace(A_TRATAMENTO, (m, trat, nome) => (ehPessoa(nome) ? `${trat}. ${MARCA_NOME}` : m))
      .replace(B_CARGO, (m, cabeca, nome, cauda) => `${cabeca}${trocaSeForPessoa(nome)}${cauda}`)
      .replace(C_DOC, (m, nome, cauda) => `${trocaSeForPessoa(nome)}${cauda}`)
      .replace(E_CARGO_DOIS_PONTOS, (m, cabeca, nome) => `${cabeca}${trocaSeForPessoa(nome)}`));
}

/**
 * mascararPII(texto) → texto sem CPF, sem RG e sem o nome de quem compôs a mesa.
 * Mantém o rótulo ("portador do CPF sob n.º [removido]", "[nome removido] — PRESIDENTE") para que
 * o leitor humano saiba que ali havia um dado — apagar sem marca esconde a edição e atrapalha
 * quem for conferir contra o original.
 */
export function mascararPII(texto) {
  if (!texto) return texto;
  const semDocumento = String(texto)
    .replace(CPF_ROTULADO, (_m, meio) => `CPF${meio}${MARCA}`)
    .replace(RG_ROTULADO, (_m, meio) => `RG${meio}${MARCA}`);
  return mascararNomesDaMesa(semDocumento);
}

/**
 * _temPII(texto) → true se ainda houver CPF/RG rotulado OU nome de mesa por mascarar. Serve de
 * GUARD na ingestão: se sobrar, aborta o arquivo em vez de gravar. Detector e mascarador
 * compartilham os mesmos padrões de propósito — se um mudar sem o outro, o teste dos dois lados
 * acusa. A regra do detector é literalmente "mascararPII mudaria alguma coisa?", então é
 * impossível existir um caso que o mascarador trata e o detector não vê.
 */
export function _temPII(texto) {
  if (!texto) return false;
  CPF_ROTULADO.lastIndex = 0;
  RG_ROTULADO.lastIndex = 0;
  const s = String(texto);
  if (CPF_ROTULADO.test(s) || RG_ROTULADO.test(s)) return true;
  return mascararNomesDaMesa(s) !== s;
}
