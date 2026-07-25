// renovar_sessao_painel.mjs — refaz o login no painel admin da Superlógica e grava o cookie novo.
// É o que tira o "renovar a sessão" da mão do Nelson: o ping diário detecta a sessão morta e chama
// este script, que loga (e-mail → senha → código lido na caixa por IMAP) e atualiza o SL_ADMIN_COOKIE.
//
// Login é Auth0 (JS no meio do caminho) → precisa de navegador. Usa `playwright-core` dirigindo o
// **chromium que já existe na imagem** (CHROME_PATH=/usr/bin/chromium-browser, posto lá pro PDF) —
// nada de baixar browser. Localmente cai no Chrome do Windows.
//
// Uso:
//   node scripts/renovar_sessao_painel.mjs              # renova e grava no arquivo de env
//   ENV_FILE=/opt/ncs/manut.env ...                     # onde gravar o SL_ADMIN_COOKIE (default esse)
//   SEM_GRAVAR=1 ...                                    # só testa o login, não toca no arquivo
//
// Credenciais (env; localmente lidas de ~/.secrets/superlogica-admin-nelson.env):
//   SL_ADMIN_USER / SL_ADMIN_PASS         login do painel
//   SL_MFA_IMAP_USER / SL_MFA_IMAP_PASS   caixa que recebe o código (senha de APP, não a do Gmail)
//   SL_MFA_IMAP_HOST / SL_MFA_IMAP_PORT
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscarCodigoMFA } from '../src/mfa_imap.mjs';
import { cookieDoState, atualizarEnvCookie, HOST_PAINEL } from '../src/painel_sessao.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(__dirname, '../../..');
const HOST = HOST_PAINEL;
const ENV_FILE = process.env.ENV_FILE || '/opt/ncs/manut.env';

// local: cofre do Nelson (fora de qualquer repo). No VPS tudo vem por env.
for (const f of [path.join(os.homedir(), '.secrets/superlogica-admin-nelson.env'), path.join(RAIZ, '.env')]) {
  if (!fs.existsSync(f)) continue;
  for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = l.trim().match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[2] && !/^[<]/.test(m[2]) && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const falta = ['SL_ADMIN_USER', 'SL_ADMIN_PASS', 'SL_MFA_IMAP_USER', 'SL_MFA_IMAP_PASS'].filter((k) => !process.env[k]);
if (falta.length) { console.error('faltam credenciais:', falta.join(', ')); process.exit(1); }

function chromePath() {
  const cands = [process.env.CHROME_PATH, '/usr/bin/chromium-browser', '/usr/bin/chromium',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].filter(Boolean);
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch { /* segue */ } }
  throw new Error('chromium não encontrado (defina CHROME_PATH)');
}

function gravarCookie(arquivo, cookie) {
  let txt = '';
  try { txt = fs.readFileSync(arquivo, 'utf8'); } catch { /* arquivo novo */ }
  fs.writeFileSync(arquivo, atualizarEnvCookie(txt, cookie), { mode: 0o600 });
}

const { chromium } = await import('playwright-core');
const inicio = new Date();
const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ locale: 'pt-BR', viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const passo = (s) => console.log('  · ' + s);

try {
  await page.goto(`https://${HOST}/clients/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  passo('tela de login: ' + page.url().replace(/\?.*/, ''));

  // 1) e-mail  (o formulário tem vários botões; Enter é o caminho estável)
  const campoEmail = await page.$('input[name="username"], input[type="email"], input#username');
  if (!campoEmail) throw new Error('não achei o campo de e-mail — tela de login mudou?');
  await campoEmail.fill(process.env.SL_ADMIN_USER);
  await campoEmail.press('Enter');
  await page.waitForTimeout(4000);

  // 2) senha
  const campoSenha = await page.$('input[type="password"]');
  if (!campoSenha) throw new Error('não pediu senha: ' + (await page.innerText('body')).replace(/\s+/g, ' ').slice(0, 160));
  await campoSenha.fill(process.env.SL_ADMIN_PASS);
  await campoSenha.press('Enter');
  await page.waitForTimeout(6000);
  const corpo = (await page.innerText('body')).replace(/\s+/g, ' ');
  if (/senha incorreta|usu[aá]rio n[aã]o encontrado|inv[aá]lid/i.test(corpo)) throw new Error('login recusado: ' + corpo.slice(0, 140));
  passo('após senha: ' + page.url().replace(/\?.*/, ''));

  // 3) código por e-mail (quando pedido)
  const precisaCodigo = /mfa|challenge/i.test(page.url()) || /c[oó]digo/i.test(corpo);
  if (precisaCodigo) {
    passo('desafio de código — buscando na caixa (só aceita e-mail posterior ao início do login)');
    const codigo = await buscarCodigoMFA({
      host: process.env.SL_MFA_IMAP_HOST || 'imap.gmail.com', port: process.env.SL_MFA_IMAP_PORT || 993,
      user: process.env.SL_MFA_IMAP_USER, pass: process.env.SL_MFA_IMAP_PASS, desde: inicio, log: passo,
    });
    if (!codigo) throw new Error('código não chegou na caixa em ~1 min');
    const campoCodigo = await page.$('input[name="code"], input[type="text"]:not([name="username"]), input[inputmode="numeric"]');
    if (!campoCodigo) throw new Error('não achei o campo do código');
    await campoCodigo.fill(codigo);
    await campoCodigo.press('Enter');
    await page.waitForTimeout(8000);
    passo('após o código: ' + page.url().replace(/\?.*/, ''));
  } else {
    passo('não pediu código (sessão SSO ainda válida no Auth0)');
  }

  // 4) chegou no painel?
  if (!/\/clients\/condor/.test(page.url())) {
    await page.goto(`https://${HOST}/clients/condor/index`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);
  }
  if (/login\.superlogica/.test(page.url())) throw new Error('não entrou: ainda na tela de login (' + page.url().replace(/\?.*/, '') + ')');
  passo('painel: ' + page.url().replace(/\?.*/, ''));

  const cookie = cookieDoState(await ctx.storageState());
  if (!/PHPSESSID=/.test(cookie)) throw new Error('cookie de sessão não veio (PHPSESSID ausente)');
  console.log('cookie novo:', cookie.split('; ').length, 'cookies /', cookie.length, 'chars');

  if (process.env.SEM_GRAVAR === '1') { console.log('SEM_GRAVAR=1 — não gravei.'); }
  else { gravarCookie(ENV_FILE, cookie); console.log('SL_ADMIN_COOKIE atualizado em', ENV_FILE); }
  console.log('RENOVACAO OK ✅');
} catch (e) {
  console.error('RENOVACAO FALHOU:', e.message.slice(0, 300));
  try { await page.screenshot({ path: (process.env.DIAG_DIR || os.tmpdir()) + '/renovacao_falhou.png' }); } catch { /* sem screenshot */ }
  process.exitCode = 1;
} finally { await browser.close(); }
