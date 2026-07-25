// painel_sessao.mjs — funções PURAS da sessão do painel admin da Superlógica.
// Vivem separadas porque são compartilhadas por `scripts/sync_manutencoes.mjs` (que consome o cookie)
// e por `scripts/renovar_sessao_painel.mjs` (que o produz) — e porque uma delas reescreve o arquivo
// de env que guarda as credenciais do Supabase: errar ali derruba o sync inteiro, então tem teste.

export const HOST_PAINEL = 'admgrupo.superlogica.net';

/**
 * storageState do navegador → header Cookie do painel.
 * ⚠️ SÓ os cookies do host: mandar os de `login.superlogica.net` junto duplica nomes (PHPSESSID…)
 * e o painel responde "Digite sua senha para entrar" — com HTTP 200, o que engana.
 * Quando o mesmo nome existe no host e no domínio-pai, o do host ganha.
 */
export function cookieDoState(state, host = HOST_PAINEL) {
  const dom = (c) => String(c.domain || '').replace(/^\./, '');
  const byName = new Map();
  for (const c of (state && state.cookies) || []) {
    const d = dom(c);
    if (d !== host && !host.endsWith('.' + d)) continue;
    const atual = byName.get(c.name);
    if (!atual || (d === host && dom(atual) !== host)) byName.set(c.name, c);
  }
  return [...byName.values()].map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * Troca (ou acrescenta) a linha SL_ADMIN_COOKIE no texto de um arquivo de env, preservando
 * TODO o resto — comentários, ordem e as outras credenciais. Devolve o texto novo.
 */
export function atualizarEnvCookie(textoAtual, cookie) {
  const linha = 'SL_ADMIN_COOKIE=' + cookie;
  const linhas = String(textoAtual || '').split(/\r?\n/);
  const i = linhas.findIndex((l) => /^\s*SL_ADMIN_COOKIE=/.test(l));
  if (i >= 0) linhas[i] = linha;
  else {
    while (linhas.length && linhas[linhas.length - 1] === '') linhas.pop();
    linhas.push(linha);
  }
  while (linhas.length && linhas[linhas.length - 1] === '') linhas.pop();
  return linhas.join('\n') + '\n';
}
