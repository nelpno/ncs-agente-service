// auditoria.mjs — log append-only durável de escritas (NÃO é log de aplicação; contém PII).
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.mjs';

function ensureDir() {
  const dir = path.dirname(config.auditLogPath);
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
}

export async function registrarEvento(ev) {
  ensureDir();
  const linha = JSON.stringify({ ts: new Date().toISOString(), ...ev }) + '\n';
  await fs.promises.appendFile(config.auditLogPath, linha, 'utf8');
}

export async function lerEventos(filtro = {}) {
  let raw;
  try { raw = await fs.promises.readFile(config.auditLogPath, 'utf8'); }
  catch { return []; }
  const evs = raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return evs.filter((e) => Object.entries(filtro).every(([k, v]) => e[k] === v));
}
