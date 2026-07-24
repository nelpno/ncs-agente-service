// sync_manutencoes.mjs — espelha as MANUTENÇÕES PROGRAMADAS do painel admin da Superlógica
// na tabela `manutencoes_agenda` (Supabase). Alimenta o Card 2 do Resumo Financeiro.
//
// ⚠️ NÃO roda no container (diferente do sync_pessoas): o dado não existe na API pública v2 e o painel
// admin exige login com MFA por e-mail. Roda na MÁQUINA DO NELSON, com o cookie da sessão salvo em
// .tmp/sl_admin_state.json e o Playwright de C:/Temp/pw-qa. Cadência sugerida: SEMANAL (o cronograma é
// anual, muda pouco). Se a sessão expirar, o script AVISA e não escreve — o card segue mostrando o
// último snapshot com a data da captura, e o Resumo nunca quebra.
//
// Uso (raiz do NCS):
//   node automacoes/agente-service/scripts/sync_manutencoes.mjs             # captura ao vivo + grava
//   SNAPSHOT=.tmp/manutencoes_snapshot.json node .../sync_manutencoes.mjs   # grava de um snapshot já capturado
//   DRY=1 ...                                                               # só mostra o que gravaria
//
// Credenciais: env primeiro; senão o .env da raiz do NCS (tokens Superlógica) e
// .tmp/ncs_supabase.json + .tmp/ncs_supabase_service_key.txt (Supabase).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linhasDoSnapshot } from '../gerador-relatorio-contas/src/manutencoes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(__dirname, '../../..'); // .../Agents/NCS
const DRY = process.env.DRY === '1';

// ---- credenciais ----
function carregarEnv() {
  const envFile = path.join(RAIZ, '.env');
  if (fs.existsSync(envFile)) {
    for (const l of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = l.trim().match(/^([A-Z0-9_]+)=(.*)$/); // CRLF-safe
      if (m && m[2] && !/^COLE_/.test(m[2])) process.env[m[1]] = m[2]; // last-wins, ignora placeholder
    }
  }
  const sbJson = path.join(RAIZ, '.tmp/ncs_supabase.json');
  const sbKey = path.join(RAIZ, '.tmp/ncs_supabase_service_key.txt');
  if (!process.env.SUPABASE_URL && fs.existsSync(sbJson)) process.env.SUPABASE_URL = JSON.parse(fs.readFileSync(sbJson, 'utf8')).SUPABASE_URL;
  if (!process.env.SUPABASE_SERVICE_KEY && fs.existsSync(sbKey)) process.env.SUPABASE_SERVICE_KEY = fs.readFileSync(sbKey, 'utf8').trim();
}
carregarEnv();

const SL_BASE = process.env.SUPERLOGICA_BASE_URL || 'https://api.superlogica.net/v2/condor';
const SL_H = {
  app_token: process.env.SUPERLOGICA_WRITE_APP_TOKEN || process.env.SUPERLOGICA_APP_TOKEN,
  access_token: process.env.SUPERLOGICA_WRITE_ACCESS_TOKEN || process.env.SUPERLOGICA_ACCESS_TOKEN,
  'Content-Type': 'application/json',
};
const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const SB_H = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };
if (!SB_URL || !SB_KEY) { console.error('faltam SUPABASE_URL/SUPABASE_SERVICE_KEY'); process.exit(1); }

// ---- captura no painel admin (Playwright + cookie da sessão) ----
const PW = process.env.PW_PATH || 'file:///C:/Temp/pw-qa/node_modules/playwright/index.js';
const STATE = process.env.SL_ADMIN_STATE || path.join(RAIZ, '.tmp/sl_admin_state.json');
const UI = 'https://admgrupo.superlogica.net/clients/condor/manutencoes/index?idmanutencao=';
const SNAP_OUT = path.join(RAIZ, '.tmp/manutencoes_snapshot.json');

async function capturar() {
  if (!fs.existsSync(STATE)) throw new Error(`sessão admin ausente (${STATE}) — logar no painel e salvar o storageState`);
  const pkg = await import(PW);
  const { chromium } = pkg.default || pkg; // playwright é CommonJS: named import quebra
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: STATE, locale: 'pt-BR', viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  try {
    await page.goto(UI + '1001', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2000);
    if (/login\.superlogica/.test(page.url())) throw new Error('SESSÃO EXPIROU — refazer o login admin (MFA) e salvar o storageState');

    // categorias pelo endpoint canônico (nome COMPLETO; a barra da UI trunca)
    const res = await page.evaluate(async () => {
      const r = await fetch('/condor/atual/manutencoes/getmanutencoes', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' }, body: '',
      });
      return { status: r.status, txt: await r.text() };
    });
    if (res.status !== 200) throw new Error('getmanutencoes HTTP ' + res.status);
    const cats = (JSON.parse(res.txt).data || []).map((c) => ({
      id: String(c.id_manutencoes_mt), nome: c.st_nome_mt, desativada: c.fl_desativada_mt,
      email_fornecedor: c.st_email_mt || null, avisar_gerente: c.fl_avisar_gerente_mt || null, id_tag: c.id_tag_ftag,
    }));
    if (!cats.length) throw new Error('nenhuma categoria retornada');

    const matrizes = {};
    for (const c of cats) {
      await page.goto(UI + c.id, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(2000);
      if (/login\.superlogica/.test(page.url())) throw new Error('SESSÃO EXPIROU no meio da captura (categoria ' + c.id + ')');
      // "Listar tudo" → todos os condomínios (a tabela vem paginada de 50)
      await page.evaluate(() => {
        const a = Array.from(document.querySelectorAll('a')).find((x) => /Listar tudo/i.test(x.innerText || ''));
        if (a) a.click();
      }).catch(() => {});
      await page.waitForTimeout(2200);
      const info = await page.evaluate(() => {
        const q = (s) => Array.from(document.querySelectorAll(s));
        const tbl = q('table').find((t) => /Condom[ií]nio/i.test(t.innerText) && /Jun|Jul/i.test(t.innerText));
        if (!tbl) return { header: [], data: [] };
        const trs = Array.from(tbl.querySelectorAll('tr'));
        const header = Array.from(trs[0].querySelectorAll('th,td')).map((x) => (x.innerText || '').trim());
        const data = [];
        for (const tr of trs.slice(1)) {
          const cells = Array.from(tr.querySelectorAll('td')).map((x) => (x.innerText || '').trim());
          const i = cells.findIndex((x) => x);
          const condo = cells[i];
          if (!condo || /Listar|Listando|Marcar|Com marcados|Agendar/i.test(condo)) continue; // rodapé/ações, não condomínio
          data.push({ condo, cells: cells.slice(i + 1) });
        }
        return { header, data };
      });
      matrizes[c.id] = info;
      console.log(String(c.id).padStart(5), c.nome.padEnd(32).slice(0, 32), String(info.data.length).padStart(3), 'condos');
    }

    const meses = (Object.values(matrizes).find((m) => m.header.length) || { header: [] }).header.filter((x) => /^[A-Z][a-z]{2}$/.test(x));
    if (meses.length !== 12) throw new Error('cabeçalho de meses inesperado: ' + JSON.stringify(meses));
    const porCondo = {};
    for (const [id, mz] of Object.entries(matrizes)) {
      const cat = (cats.find((c) => c.id === id) || {}).nome || ('cat' + id);
      for (const row of mz.data) {
        porCondo[row.condo] = porCondo[row.condo] || {};
        const agenda = {};
        row.cells.forEach((v, i) => { if (v && meses[i]) agenda[meses[i]] = v; });
        if (Object.keys(agenda).length) porCondo[row.condo][cat] = agenda;
      }
    }
    return {
      capturado_em: new Date().toISOString(), meses,
      categorias: cats.map((c) => ({ id: c.id, nome: c.nome })), categorias_raw: cats, porCondo, matrizes,
      endpoint_categorias: 'POST /condor/atual/manutencoes/getmanutencoes',
    };
  } finally { await browser.close(); }
}

// ---- condomínios (API pública) e casamento por NOME EXATO ----
const norm = (s) => String(s || '').normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
  .toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

async function listarCondominios() {
  const r = await fetch(`${SL_BASE}/condominios/get?id=-1`, { headers: SL_H, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error('condominios/get ' + r.status);
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error('condominios/get resposta inesperada');
  return j.map((c) => ({ id: Number(c.id_condominio_cond || c.id), fantasia: c.st_fantasia_cond || '', nome: c.st_nome_cond || '' })).filter((c) => c.id);
}

// ---- Supabase ----
async function sbDeleteTudo() {
  const r = await fetch(`${SB_URL}/rest/v1/manutencoes_agenda?id_condominio=gt.0`, { method: 'DELETE', headers: { ...SB_H, Prefer: 'return=minimal' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error('delete ' + r.status + ' ' + (await r.text()).slice(0, 120));
}
async function sbInsert(rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const r = await fetch(`${SB_URL}/rest/v1/manutencoes_agenda`, { method: 'POST', headers: { ...SB_H, Prefer: 'return=minimal' }, body: JSON.stringify(rows.slice(i, i + 500)), signal: AbortSignal.timeout(45000) });
    if (!r.ok) throw new Error('insert ' + r.status + ' ' + (await r.text()).slice(0, 200));
  }
}

// ---- main ----
const snapArg = process.env.SNAPSHOT;
let snap;
if (snapArg) {
  const p = path.isAbsolute(snapArg) ? snapArg : path.join(RAIZ, snapArg);
  snap = JSON.parse(fs.readFileSync(p, 'utf8'));
  console.log('snapshot lido de', p, '| capturado_em', snap.capturado_em);
} else {
  snap = await capturar();
  fs.writeFileSync(SNAP_OUT, JSON.stringify(snap, null, 1));
  console.log('snapshot salvo em', SNAP_OUT);
}

const condos = await listarCondominios();
const porNome = new Map();
for (const c of condos) for (const n of [c.fantasia, c.nome]) if (n && !porNome.has(norm(n))) porNome.set(norm(n), c.id);
// NOME EXATO (normalizado). Sem match → descarta e reporta: manutenção do prédio errado é pior que card ausente.
const resolverId = (painel) => porNome.get(norm(painel)) || null;

const { linhas, ignorados } = linhasDoSnapshot(snap, resolverId);
// dedupe pela chave única (condo × categoria × mês) — a última célula vence
const unica = new Map();
for (const l of linhas) unica.set(`${l.id_condominio}|${l.categoria_id}|${l.ano}|${l.mes}`, l);
const rows = [...unica.values()];

const condosComDado = new Set(rows.map((r) => r.id_condominio)).size;
console.log(`\ncondomínios no painel: ${Object.keys(snap.porCondo).length} | casados: ${condosComDado} | linhas: ${rows.length}`);
if (ignorados.length) console.log('IGNORADOS (nome não casou com a API pública):', ignorados.join(' | '));
const porStatus = rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});
console.log('por status:', JSON.stringify(porStatus));

if (DRY) { console.log('\nDRY=1 — nada gravado.'); process.exit(0); }
if (!rows.length) { console.error('ZERO linhas — não vou apagar o espelho existente.'); process.exit(1); }
await sbDeleteTudo();
await sbInsert(rows);
console.log(`\nSYNC OK | ${rows.length} linhas | ${condosComDado} condomínios | captura ${snap.capturado_em}`);
