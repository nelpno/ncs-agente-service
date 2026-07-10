// classificar.mjs — tag do RESÍDUO (turno sem ferramenta): LLM barato (Gemini flash), fire-and-forget.
// Roda DEPOIS de responder ao usuário; só toca a linha se tag AINDA está null. NUNCA lança.
import { sbUpdate } from "./db.mjs";
import { TAXONOMIA } from "./tags.mjs";

export async function classificarAsync(id, texto, { fetchImpl = fetch, updateFn = sbUpdate } = {}) {
  try {
    const key = process.env.GEMINI_API_KEY;
    if (!key || !id || !texto) return;
    const cats = TAXONOMIA.join(", ");
    const prompt =
      `Classifique a mensagem de um funcionário de administração de condomínios em UMA categoria da lista: ${cats}.\n` +
      `Responda APENAS o nome exato da categoria, minúsculo, sem explicação.\n\nMensagem: "${String(texto).slice(0, 400)}"`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
    const r = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 20, thinkingConfig: { thinkingBudget: 0 } } }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return;
    const j = await r.json();
    let tag = (j.candidates?.[0]?.content?.parts?.[0]?.text || "").trim().toLowerCase();
    if (!TAXONOMIA.includes(tag)) tag = "outro";
    // só grava se ninguém definiu a tag ainda (a determinística venceria)
    await updateFn("interacoes", `id=eq.${encodeURIComponent(id)}&tag=is.null`, { tag });
  } catch { /* nunca lança — fica null (painel trata como "outro") */ }
}
