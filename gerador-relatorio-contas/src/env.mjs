// Carrega o .env da raiz do projeto NCS (last-wins, ignora placeholders COLE_*).
// Sobe a árvore de diretórios até achar um .env com SUPERLOGICA_APP_TOKEN.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function loadEnv(startDir) {
  const here = startDir || path.dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 6; i++) {
    const p = path.join(dir, '.env');
    if (fs.existsSync(p)) {
      const txt = fs.readFileSync(p, 'utf8');
      if (/SUPERLOGICA_APP_TOKEN/.test(txt)) {
        for (const l of txt.split(/\r?\n/)) {
          const s = l.replace(/\r$/, '').trim();
          if (!s || s.startsWith('#')) continue;
          const idx = s.indexOf('=');
          if (idx < 0) continue;
          const k = s.slice(0, idx).trim();
          const v = s.slice(idx + 1).trim();
          if (!/^COLE_/.test(v)) process.env[k] = v; // last-wins: token real vence o placeholder
        }
        return p;
      }
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  // No container (chat-ncs) NÃO existe .env em disco — os tokens vêm de process.env injetado pelo deploy.
  // Por isso NÃO lançamos erro: só retornamos null e quem usa lê de process.env normalmente.
  return null;
}
