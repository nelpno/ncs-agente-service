// visao.mjs — Fase 2 (multimodal) do Estagiário.
// A equipe anexa uma FOTO da ocorrência, um PRINT de conversa com o morador ou um PDF.
// Como o loop do Estagiário é text-only (gpt-5.4 via OpenAI), aqui a gente LÊ o arquivo com o
// Gemini visão e devolve uma DESCRIÇÃO/OCR em texto — o mesmo padrão do adapter da Ana no Chatwoot.
// Esse texto vira a base factual: o LLM compõe o `relato` da notificação/multa OU sugere a resposta
// pelo regimento. Anti-alucinação: a extração é fiel; o LLM não inventa além do que está no arquivo.

const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash";
const MAX_BYTES = 18 * 1024 * 1024; // 18 MB (mesmo teto do adapter)
const TIMEOUT_MS = parseInt(process.env.VISAO_TIMEOUT_MS || "45000", 10);

const PROMPT = `Você ajuda a EQUIPE de uma administradora de condomínios a interpretar um arquivo enviado por um gestor/síndico. Responda em português do Brasil, SÓ com o que está no arquivo — não invente, não opine, não faça enquadramento jurídico:
- FOTO de uma ocorrência (dano, lixo, irregularidade, obra, objeto em local proibido, veículo, etc.): descreva de forma objetiva e detalhada o que se vê (o quê, onde, estado/condição). Nada de julgamento.
- PRINT de conversa (WhatsApp/SMS/e-mail): transcreva o texto literal na ordem, indicando quem falou quando der para identificar (morador, síndico, etc.).
- DOCUMENTO/PDF (notificação, laudo, comprovante, boleto, contrato): extraia o texto e os dados principais (nomes, datas, valores, CPF).
Seja fiel e conciso. Se não for possível ler o conteúdo, responda apenas: (ilegível).`;

const DATA_URL_RE = /^data:([^;,]+);base64,([\s\S]*)$/;

/** Aceita "data:<mime>;base64,<dados>" e devolve { mime, buf } ou null. */
export function parseDataUrl(dataUrl) {
  const m = (dataUrl || "").match(DATA_URL_RE);
  if (!m) return null;
  try {
    return { mime: m[1].toLowerCase(), buf: Buffer.from(m[2], "base64") };
  } catch {
    return null;
  }
}

function kindOf(mime) {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  return "outro";
}

/**
 * Lê um anexo (data URL) com o Gemini visão.
 * @returns {Promise<{ok:boolean, txt:string, kind?:string, mime?:string, motivo?:string}>}
 *  motivo: sem_gemini | formato | grande | tipo | ilegivel | erro
 */
export async function descreverAnexo(dataUrl) {
  if (!GEMINI_KEY) return { ok: false, txt: "", motivo: "sem_gemini" };
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return { ok: false, txt: "", motivo: "formato" };
  const { mime, buf } = parsed;
  if (!buf.length) return { ok: false, txt: "", motivo: "formato" };
  if (buf.length > MAX_BYTES) return { ok: false, txt: "", motivo: "grande" };
  const kind = kindOf(mime);
  if (kind === "outro") return { ok: false, txt: "", motivo: "tipo", mime };

  const body = {
    contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: buf.toString("base64") } }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 1024 },
  };
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    const j = await r.json().catch(() => ({}));
    const txt = ((j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [])
      .map((p) => p.text).filter(Boolean).join(" ").trim();
    if (!txt || /^\(?\s*ileg[ií]vel/i.test(txt)) return { ok: false, txt: "", kind, mime, motivo: "ilegivel" };
    return { ok: true, txt, kind, mime };
  } catch (e) {
    return { ok: false, txt: "", kind, mime, motivo: "erro", erro: e.message };
  }
}

/** Monta a mensagem do usuário juntando o texto digitado com o conteúdo lido do anexo.
 *  Fica separado para ser testável sem rede. */
export function montarMensagemComAnexo(msg, vis) {
  const base = (msg || "").trim();
  if (vis && vis.ok && vis.txt) {
    const rot = vis.kind === "image" ? "IMAGEM/FOTO" : vis.kind === "pdf" ? "DOCUMENTO PDF" : "ARQUIVO";
    const bloco = `[Anexo enviado pela equipe — ${rot}. Conteúdo lido do arquivo (use como base factual, não invente nada além disto): ${vis.txt}]`;
    return base ? `${base}\n\n${bloco}` : bloco;
  }
  const motivo = vis && vis.motivo === "grande" ? "o arquivo é grande demais"
    : vis && vis.motivo === "tipo" ? "esse tipo de arquivo não é suportado (envie foto ou PDF)"
    : "não foi possível ler o conteúdo";
  const bloco = `[A equipe anexou um arquivo, mas ${motivo}. Peça para descrever por texto ou reenviar mais nítido, e não invente o conteúdo.]`;
  return base ? `${base}\n\n${bloco}` : bloco;
}
