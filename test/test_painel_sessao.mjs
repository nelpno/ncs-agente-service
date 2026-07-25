// Sessão do painel admin: montagem do header Cookie e reescrita do arquivo de env.
// Por que tem teste: `atualizarEnvCookie` reescreve o MESMO arquivo que guarda SUPABASE_SERVICE_KEY
// e SMTP_PASS no VPS — perder uma linha ali derruba o sync e o aviso de falha junto com ele.
import { cookieDoState, atualizarEnvCookie, HOST_PAINEL } from '../src/painel_sessao.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FALHOU:', m); } };

// ---- cookieDoState ----
const state = {
  cookies: [
    { name: 'PHPSESSID', value: 'do-painel', domain: HOST_PAINEL },
    { name: 'PHPSESSID', value: 'do-login', domain: 'login.superlogica.net' },   // NÃO deve entrar
    { name: 'server-id', value: 'x1', domain: '.superlogica.net' },              // domínio-pai: entra
    { name: 'sl_vertical', value: 'condor', domain: HOST_PAINEL },
    { name: 'ga', value: 'z', domain: 'google.com' },                            // outro host: fora
  ],
};
const h = cookieDoState(state);
ok(/PHPSESSID=do-painel/.test(h), 'cookie do host deveria vencer: ' + h);
ok(!/do-login/.test(h), 'cookie de login.superlogica.net vazou (duplica nome → painel pede senha)');
ok(/server-id=x1/.test(h), 'cookie do domínio-pai deveria entrar');
ok(!/google/.test(h) && !/ga=z/.test(h), 'cookie de outro host vazou');
ok(h.split('; ').length === 3, 'esperava 3 cookies, veio ' + h.split('; ').length + ': ' + h);
ok(cookieDoState({}) === '' && cookieDoState(null) === '', 'state vazio deveria dar string vazia');

// ---- atualizarEnvCookie ----
const ANTES = [
  '# comentário no topo',
  'SL_ADMIN_COOKIE=velho',
  'SUPABASE_URL=https://x.supabase.co',
  'SUPABASE_SERVICE_KEY=chave-secreta',
  'SMTP_PASS=senha',
  '',
].join('\n');
const depois = atualizarEnvCookie(ANTES, 'novo=1; outro=2');
ok(/^SL_ADMIN_COOKIE=novo=1; outro=2$/m.test(depois), 'cookie não foi trocado: ' + depois);
ok(!/velho/.test(depois), 'cookie velho ficou no arquivo');
for (const linha of ['# comentário no topo', 'SUPABASE_URL=https://x.supabase.co', 'SUPABASE_SERVICE_KEY=chave-secreta', 'SMTP_PASS=senha']) {
  ok(depois.includes(linha), 'PERDEU uma linha do env: ' + linha);
}
ok((depois.match(/^SL_ADMIN_COOKIE=/gm) || []).length === 1, 'duplicou a linha do cookie');
ok(depois.endsWith('\n') && !depois.endsWith('\n\n'), 'arquivo deveria terminar com exatamente uma quebra');

// sem a linha ainda: acrescenta no fim, sem comer o resto
const semLinha = atualizarEnvCookie('SUPABASE_URL=https://x\n', 'abc=1');
ok(/SUPABASE_URL=https:\/\/x/.test(semLinha) && /SL_ADMIN_COOKIE=abc=1/.test(semLinha), 'não acrescentou: ' + JSON.stringify(semLinha));
ok(atualizarEnvCookie('', 'abc=1') === 'SL_ADMIN_COOKIE=abc=1\n', 'arquivo vazio: ' + JSON.stringify(atualizarEnvCookie('', 'abc=1')));
// idempotente: rodar duas vezes não muda nada
ok(atualizarEnvCookie(depois, 'novo=1; outro=2') === depois, 'não é idempotente');
// espaço antes do nome (arquivo editado à mão) ainda é reconhecido como a mesma linha
ok((atualizarEnvCookie('  SL_ADMIN_COOKIE=velho\n', 'novo').match(/SL_ADMIN_COOKIE/g) || []).length === 1, 'linha indentada duplicou');

console.log(`\ntest_painel_sessao: ${pass} OK, ${fail} FALHOU`);
if (fail) process.exit(1);
