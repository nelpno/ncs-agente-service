// copiloto.mjs — monta o PEDIDO de sugestão de resposta que o painel de atendimento manda ao Estagiário.
//
// Contexto (17/08/2026): o copiloto nativo do Chatwoot (integração `openai`, o menu "Sugerir uma
// resposta") está MORTO na imagem 4.15.1 — a rota do botão devolve HTTP 422 e o próprio código diz
// "OpenAI integration migrated to Captain::EditorService", serviço que não existe nesta build. Em vez
// de ressuscitá-lo, o painel passa a pedir a sugestão AQUI: o Estagiário já enxerga regimento,
// convenção, 219 atas, Código Civil, taxa, mudança, portaria, garantidora e cobrança — que era
// exatamente o que faltava ao nativo (ele escrevia sobre regra sem lastro, assinado pela NCS).
//
// Tudo neste arquivo é PURO (sem rede, sem LLM): é o que o teste exercita.
//
// ⚠️ O texto tratado aqui é de TERCEIRO (quem escreveu o e-mail) e vai DENTRO do prompt do modelo.
// É superfície de injeção — daí a higiene e os tetos serem obrigatórios e testados.

export const LIMITE_MSG = 4000; // por mensagem (thread de e-mail vem com a conversa inteira colada)
export const LIMITE_TOTAL = 24000; // histórico inteiro
export const MAX_MSGS = 20; // nº de balões considerados (os ÚLTIMOS)

/**
 * Deixa o texto de terceiro seguro para entrar no prompt, SEM mutilar português.
 * Tira `<`/`>` (fecham bloco e carregam markup), colapsa espaço em branco e corta no limite.
 * Acento, cedilha, número e pontuação passam intactos — o modelo precisa ler o pedido como escrito.
 */
export function higienizar(txt, limite = LIMITE_MSG) {
  let s = String(txt ?? "")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > limite) s = s.slice(0, limite) + " […cortado]";
  return s;
}

const ROTULO = { cliente: "quem escreveu", equipe: "equipe NCS" };

/**
 * @param {object} p
 * @param {'email'|'whatsapp'|string} p.canal   canal da conversa (só 'email' muda a forma da resposta)
 * @param {{de:'cliente'|'equipe', texto:string}[]} p.mensagens  histórico em ordem cronológica
 * @param {string} [p.assinatura]  assinatura oficial já cadastrada; ausente = proibido inventar
 * @param {string} [p.condominio]  condomínio já identificado, quando houver
 * @returns {string|null}  o pedido pronto, ou null quando não há o que sugerir (falha FECHADA)
 */
export function montarPedidoCopiloto({ canal, mensagens, assinatura, condominio } = {}) {
  const lista = Array.isArray(mensagens) ? mensagens : [];

  // Sem nenhuma fala de quem escreveu, não há pedido a responder: melhor NENHUMA nota do que uma
  // sugestão inventada sobre uma conversa vazia.
  const temCliente = lista.some((m) => m && m.de === "cliente" && String(m.texto ?? "").trim());
  if (!temCliente) return null;

  // Fica com os ÚLTIMOS balões: o pedido atual é o que importa, e o teto protege o custo.
  const recentes = lista.slice(-MAX_MSGS);

  const linhas = [];
  let total = 0;
  for (const m of recentes) {
    const texto = higienizar(m && m.texto);
    if (!texto) continue;
    const linha = `${ROTULO[m.de] || "equipe NCS"}: ${texto}`;
    total += linha.length;
    linhas.push(linha);
  }
  // Estourou o teto total: descarta do INÍCIO (mais antigo), nunca do fim.
  while (total > LIMITE_TOTAL && linhas.length > 1) {
    total -= linhas.shift().length;
  }

  const ehEmail = String(canal || "").toLowerCase() === "email";

  const forma = ehEmail
    ? [
        "Esta conversa é por E-MAIL. Escreva um e-mail de resposta:",
        "- comece com uma saudação;",
        "- desenvolva o assunto com clareza, em parágrafos curtos;",
        "- encerre com uma despedida cordial.",
        assinatura
          ? `- termine exatamente com esta assinatura:\n${higienizar(assinatura, 400)}`
          : "- NÃO invente assinatura, cargo, telefone nem CNPJ: encerre na despedida e deixe a assinatura para quem enviar.",
      ].join("\n")
    : [
        "Esta conversa é por chat. Escreva uma resposta curta de chat:",
        "- direta, sem saudação formal e sem despedida;",
        "- uma ideia por frase.",
      ].join("\n");

  return [
    "Você está ajudando a equipe de atendimento do Grupo NCS a responder a conversa abaixo.",
    "Quem vai ler a sua saída é a PRÓPRIA EQUIPE, que revisa e envia. Escreva o texto pronto para ser enviado.",
    "",
    forma,
    "",
    "Regras:",
    "- Se o assunto envolver regra de condomínio (mudança, obra, animal, garagem, multa, taxa, assembleia),",
    "  consulte as suas ferramentas e responda com base no que elas devolverem, citando o documento.",
    "  Se a ferramenta não trouxer a regra, diga que vai confirmar — nunca escreva a regra de memória.",
    "- Não prometa prazo, valor nem decisão que não esteja no material consultado.",
    "- NÃO gere documento (.doc/PDF), notificação, multa nem declaração: esta é uma sugestão de resposta.",
    "- Responda apenas o texto sugerido, sem comentários seus e sem explicar o que fez.",
    condominio ? `\nCondomínio já identificado: ${higienizar(condominio, 120)}` : "",
    "",
    "Conversa (mais antiga primeiro):",
    ...linhas,
  ]
    .filter((l) => l !== "")
    .join("\n");
}
