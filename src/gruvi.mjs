// gruvi.mjs — acha o vídeo tutorial OFICIAL do app Gruvi que responde a dúvida "como faço X no app?".
// Isolado e anti-alucinação (mesmo padrão dos outros módulos): só devolve link que EXISTE na base; sem match -> encontrou:false.
// Fonte: data/videos-gruvi.json (playlist oficial Superlógica/Gruvi, 23 vídeos). A Ana manda o link; nunca compõe um.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'videos-gruvi.json'), 'utf8'));

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// buscar_video(assunto) -> { encontrou, titulo, url } do melhor match, ou { encontrou:false }.
// Pontua: tema (frase) contido no assunto = sinal forte (+3); palavra do assunto no título = sinal fraco (+1).
export function buscar_video(assunto) {
  const a = norm(assunto);
  if (!a) return { encontrou: false };
  let best = null, bestScore = 0;
  for (const v of (DB.videos || [])) {
    let score = 0;
    for (const tema of (v.temas || [])) { const t = norm(tema); if (t && a.includes(t)) score += 3; }
    const tit = norm(v.titulo);
    for (const w of a.split(' ')) { if (w.length >= 4 && tit.includes(w)) score += 1; }
    if (score > bestScore) { bestScore = score; best = v; }
  }
  if (!best || bestScore === 0) return { encontrou: false };
  return { encontrou: true, titulo: best.titulo, url: best.url };
}
