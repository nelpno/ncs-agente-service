// sync_manutencoes.mjs — espelha as MANUTENÇÕES PROGRAMADAS do painel admin da Superlógica
// na tabela `manutencoes_agenda` (Supabase). Alimenta o Card 2 do Resumo Financeiro.
//
// ⚠️ O dado não existe na API pública v2 — só no painel admin, que é autenticado por COOKIE de
// sessão (login Auth0 com MFA por e-mail). Por isso o espelho.
//
// SEM NAVEGADOR: a matriz vem de um endpoint JSON interno
//   POST /condor/atual/manutencoes/index   body: json={"params":[{"idmanutencao":"<cat>","pagina":N}]}
// que devolve `id_condominio_cond` (o id do Superlógica direto — zero casamento por nome), os meses
// de recorrência (`fl_jan_mc`…`fl_dez_mc`) e a data da próxima manutenção (`dt_manutencao_mc`).
// A célula do painel é derivada disso por `derivarCelula` (regra conferida 266/266 contra o HTML).
//
// Uso (raiz do NCS):
//   node automacoes/agente-service/scripts/sync_manutencoes.mjs          # captura + grava
//   DRY=1 ...                                                            # só mostra o que gravaria
// No VPS (cron semanal), tudo por env — nenhum arquivo necessário:
//   docker run --rm --env-file /opt/ncs/manut.env ghcr.io/nelpno/ncs-agente-service:latest \
//     node scripts/sync_manutencoes.mjs
//
// Credenciais:
//   SL_ADMIN_COOKIE       header Cookie da sessão do painel (obrigatório; localmente cai no
//                         .tmp/sl_admin_state.json do Playwright, se existir)
//   SUPABASE_URL / SUPABASE_SERVICE_KEY
//   ALERTA_EMAIL + SMTP_* (opcional): avisa quando a sessão expirar — ver `avisar()`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linhasDosRegistros } from '../gerador-relatorio-contas/src/manutencoes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(__dirname, '../../..'); // .../Agents/NCS (só existe no ambiente local)
const DRY = process.env.DRY === '1';
const HOST = 'admgrupo.superlogica.net';
const BASE = 'https://' + HOST;

// ---- credenciais ----
function carregarLocal() {
  const envFile = path.join(RAIZ, '.env');
  if (fs.existsSync(envFile)) {
    for (const l of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = l.trim().match(/^([A-Z0-9_]+)=(.*)$/); // CRLF-safe
      if (m && m[2] && !/^COLE_/.test(m[2])) process.env[m[1]] = m[2];
    }
  }
  const sbJson = path.join(RAIZ, '.tmp/ncs_supabase.json');
  const sbKey = path.join(RAIZ, '.tmp/ncs_supabase_service_key.txt');
  if (!process.env.SUPABASE_URL && fs.existsSync(sbJson)) process.env.SUPABASE_URL = JSON.parse(fs.readFileSync(sbJson, 'utf8')).SUPABASE_URL;
  if (!process.env.SUPABASE_SERVICE_KEY && fs.existsSync(sbKey)) process.env.SUPABASE_SERVICE_KEY = fs.readFileSync(sbKey, 'utf8').trim();
  // cookie da sessão salva pelo Playwright (só p/ rodar da máquina do Nelson)
  const state = process.env.SL_ADMIN_STATE || path.join(RAIZ, '.tmp/sl_admin_state.json');
  if (!process.env.SL_ADMIN_COOKIE && fs.existsSync(state)) process.env.SL_ADMIN_COOKIE = cookieDoState(JSON.parse(fs.readFileSync(state, 'utf8')));
}

// só os cookies válidos p/ o host do painel; o host-específico ganha do domínio-pai.
// (mandar os de login.superlogica.net junto duplica nomes e o servidor responde "Digite sua senha".)
export function cookieDoState(state) {
  const dom = (c) => c.domain.replace(/^\./, '');
  const byName = new Map();
  for (const c of state.cookies || []) {
    const d = dom(c);
    if (d !== HOST && !HOST.endsWith('.' + d)) continue;
    const atual = byName.get(c.name);
    if (!atual || (d === HOST && dom(atual) !== HOST)) byName.set(c.name, c);
  }
  return [...byName.values()].map((c) => `${c.name}=${c.value}`).join('; ');
}

try { carregarLocal(); } catch {}
const COOKIE = process.env.SL_ADMIN_COOKIE;
const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const SB_H = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };

// ---- aviso (opcional): a sessão do painel expira e alguém precisa refazer o login com MFA ----
async function avisar(assunto, corpo) {
  const para = process.env.ALERTA_EMAIL;
  if (!para || !process.env.SMTP_HOST) { console.log('[aviso] (sem ALERTA_EMAIL/SMTP) ' + assunto); return; }
  try {
    const { default: nodemailer } = await import('nodemailer');
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 465),
      secure: String(process.env.SMTP_SECURE || 'true') === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await t.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: para, subject: assunto, text: corpo });
    console.log('[aviso] e-mail enviado para', para);
  } catch (e) { console.log('[aviso] falhou:', e.message.slice(0, 120)); }
}

function faltando() {
  const f = [];
  if (!COOKIE) f.push('SL_ADMIN_COOKIE');
  if (!SB_URL) f.push('SUPABASE_URL');
  if (!SB_KEY) f.push('SUPABASE_SERVICE_KEY');
  return f;
}

// ---- API interna (cookie) ----
const H = (ref) => ({
  cookie: COOKIE, accept: '*/*', 'accept-language': 'pt-BR',
  'content-type': 'application/x-www-form-urlencoded', origin: BASE,
  referer: `${BASE}/clients/condor/manutencoes/index?idmanutencao=${ref}`,
  'x-requested-with': 'XMLHttpRequest',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
});

// ⚠️ o painel responde HTTP 200 mesmo quando a sessão morreu — o status REAL vem no corpo.
class SessaoExpirada extends Error {}
async function post(acao, params, ref) {
  const body = 'json=' + encodeURIComponent(JSON.stringify({ params: [params], url: `${BASE}/condor/atual/${acao}` }));
  const r = await fetch(`${BASE}/condor/atual/${acao}`, { method: 'POST', headers: H(ref), body, signal: AbortSignal.timeout(60000) });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch {}
  if (!j) throw new Error(`${acao}: resposta não-JSON (HTTP ${r.status}) ${txt.slice(0, 120)}`);
  if (String(j.status) === '401') throw new SessaoExpirada(`${acao}: ${j.msg || 'sessão expirada'}`);
  if (String(j.status) !== '200') throw new Error(`${acao}: status ${j.status} ${j.msg || ''}`);
  return j.data || [];
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
const falta = faltando();
if (falta.length) { console.error('faltam credenciais:', falta.join(', ')); process.exit(1); }

let regs = [];
try {
  const cats = await post('manutencoes/getmanutencoes', {}, 1001);
  if (!cats.length) throw new Error('nenhuma categoria retornada');
  console.log('categorias:', cats.length);
  for (const c of cats) {
    const id = c.id_manutencoes_mt;
    for (let pg = 1; pg <= 20; pg++) {          // o painel pagina de 50 em 50
      const d = await post('manutencoes/index', { idmanutencao: String(id), pagina: pg }, id);
      regs = regs.concat(d);
      if (d.length < 50) break;
    }
  }
} catch (e) {
  if (e instanceof SessaoExpirada) {
    console.error('🔴 SESSÃO DO PAINEL EXPIROU —', e.message);
    console.error('   Espelho NÃO foi tocado: o card segue mostrando a última captura, com a data.');
    await avisar('NCS: sessão do painel Superlógica expirou (manutenções)',
      'O sync das manutenções programadas não rodou porque a sessão do painel admin expirou.\n'
      + 'Refaça o login (MFA) e atualize o SL_ADMIN_COOKIE.\n\nDetalhe: ' + e.message);
    process.exit(2);
  }
  console.error('ERRO na captura:', e.message);
  process.exit(1);
}

const { linhas, semId } = linhasDosRegistros(regs, { capturadoEm: new Date().toISOString() });
const unica = new Map();
for (const l of linhas) unica.set(`${l.id_condominio}|${l.categoria_id}|${l.ano}|${l.mes}`, l);
const rows = [...unica.values()];
const condos = new Set(rows.map((r) => r.id_condominio)).size;
const porStatus = rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});
console.log(`registros: ${regs.length} | condomínios: ${condos} | linhas: ${rows.length} | ${JSON.stringify(porStatus)}`);
if (semId.length) console.log('SEM id_condominio (descartados):', semId.join(' | '));

if (DRY) { console.log('DRY=1 — nada gravado.'); process.exit(0); }
if (!rows.length) { console.error('ZERO linhas — não vou apagar o espelho existente.'); process.exit(1); }
await sbDeleteTudo();
await sbInsert(rows);
console.log(`SYNC OK | ${rows.length} linhas | ${condos} condomínios | ${new Date().toISOString()}`);
