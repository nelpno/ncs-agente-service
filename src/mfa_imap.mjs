// mfa_imap.mjs — lê o CÓDIGO DE VERIFICAÇÃO do login da Superlógica na caixa de e-mail.
// Cliente IMAP mínimo em `node:tls` (sem dependência): LOGIN / SELECT / SEARCH / FETCH bastam.
//
// Fatos medidos na caixa real (24/07/2026), que ditam o desenho:
//   - remetente do CÓDIGO: `auth@superlogica.com`, assunto "Seu código de verificação Superlógica".
//     ⚠️ `no-reply@superlogica.net` manda "Alerta de segurança — Novo login" e cai no SPAM: NÃO é o código.
//   - corpo em quoted-printable UTF-8: "Seu c=C3=B3digo de verifica=C3=A7=C3=A3o =C3=A9: =20 021867".
//   - a mensagem pode NÃO estar na INBOX (some por filtro/arquivamento), então varremos
//     "[Gmail]/Todos os e-mails" e a Lixeira também.
// FRESCOR é obrigatório: só aceita código de mensagem posterior ao início do login — código velho
// leva a "código inválido" e a um segundo pedido, o pior dos mundos (parece bug de senha).
import tls from 'node:tls';

const PASTAS = ['INBOX', '"[Gmail]/Todos os e-mails"', '"[Gmail]/All Mail"', '"[Gmail]/Lixeira"'];
const REMETENTE_CODIGO = 'auth@superlogica.com';

function conectar({ host, port, timeoutMs = 20000 }) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port: Number(port), servername: host }, () => resolve(api));
    sock.setTimeout(timeoutMs, () => { sock.destroy(new Error('IMAP timeout')); });
    let buf = '';
    const esperando = [];
    sock.setEncoding('utf8');
    sock.on('data', (d) => {
      buf += d;
      for (let i = 0; i < esperando.length; i++) {
        const w = esperando[i];
        const m = buf.match(new RegExp('^' + w.tag + ' (OK|NO|BAD)([^\r\n]*)', 'm'));
        if (m) { const texto = buf; buf = ''; esperando.splice(i, 1); i--; w.resolve({ status: m[1], linha: m[2], texto }); }
      }
    });
    sock.on('error', reject);
    let n = 0;
    const api = {
      cmd(linha) {
        const tag = 'a' + (++n);
        return new Promise((res, rej) => {
          esperando.push({ tag, resolve: res });
          sock.write(tag + ' ' + linha + '\r\n');
          setTimeout(() => rej(new Error('IMAP sem resposta: ' + linha.split(' ')[0])), timeoutMs);
        });
      },
      fim() { try { sock.end(); } catch { /* já fechado */ } },
    };
  });
}

const idsDe = (r) => ((r.texto.match(/^\* SEARCH([^\r\n]*)/m) || ['', ''])[1]).trim().split(/\s+/).filter(Boolean);

/**
 * quoted-printable → texto. ⚠️ `=XX` são BYTES, não code points: decodificar com
 * String.fromCharCode viraria mojibake ("código" → "cÃ³digo") e o rótulo deixaria de casar —
 * foi exatamente o que fez a 1ª versão descartar um e-mail que estava na caixa.
 */
export function decodeQP(s) {
  const semSoft = String(s || '').replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < semSoft.length; i++) {
    if (semSoft[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(semSoft.substr(i + 1, 2))) {
      bytes.push(parseInt(semSoft.substr(i + 1, 2), 16)); i += 2;
    } else bytes.push(semSoft.charCodeAt(i) & 0xff);
  }
  return Buffer.from(bytes).toString('utf8');
}

/**
 * Extrai o código de 6 dígitos do corpo. **Sem o rótulo esperado devolve null** — nunca chuta um
 * número solto (o e-mail tem outros: protocolo, ano, id). O rótulo é casado de forma tolerante a
 * acento/encoding, mas o texto "verificação" tem de estar lá.
 */
export function extrairCodigo(corpo) {
  const t = decodeQP(corpo).replace(/\s+/g, ' ');
  for (const re of [/c\S{0,4}digo de verifica\S*[^\d]{0,20}(\d{6})/i, /verifica\S*[^\d]{0,40}?(\d{6})/i]) {
    const m = t.match(re);
    if (m) return m[1];
  }
  return null;
}

/** Data do header (para exigir frescor). */
function dataDoHeader(bloco) {
  const m = bloco.match(/^Date:\s*([^\r\n]+)/mi);
  const d = m ? new Date(m[1]) : null;
  return d && !isNaN(d) ? d : null;
}

/**
 * buscarCodigoMFA({host, port, user, pass, desde, tentativas, esperaMs}) → código | null.
 * `desde` = Date; só aceita mensagem com Date >= desde (menos 2 min de folga de relógio).
 * Faz polling porque o e-mail leva alguns segundos para chegar.
 */
export async function buscarCodigoMFA({ host, port, user, pass, desde, tentativas = 12, esperaMs = 5000, log = () => {} }) {
  const piso = new Date((desde ? desde.getTime() : Date.now()) - 2 * 60000);
  for (let t = 1; t <= tentativas; t++) {
    let c;
    try {
      c = await conectar({ host, port });
      const login = await c.cmd(`LOGIN "${user}" "${pass}"`);
      if (login.status !== 'OK') throw new Error('IMAP LOGIN ' + login.status);
      for (const pasta of PASTAS) {
        const sel = await c.cmd('SELECT ' + pasta);
        if (sel.status !== 'OK') continue;
        const ids = idsDe(await c.cmd(`SEARCH FROM "${REMETENTE_CODIGO}"`));
        if (!ids.length) continue;
        // do mais novo para o mais velho; para no primeiro fresco
        for (const id of ids.slice(-5).reverse()) {
          const f = await c.cmd(`FETCH ${id} (BODY.PEEK[HEADER.FIELDS (DATE SUBJECT)] BODY.PEEK[TEXT])`);
          const quando = dataDoHeader(f.texto);
          if (!quando || quando < piso) continue;
          const codigo = extrairCodigo(f.texto);
          if (codigo) { log(`código encontrado em ${pasta} (msg de ${quando.toISOString()})`); c.fim(); return codigo; }
        }
      }
      c.fim();
    } catch (e) { try { c && c.fim(); } catch { /* ignora */ } log(`tentativa ${t}: ${e.message.slice(0, 80)}`); }
    if (t < tentativas) await new Promise((r) => setTimeout(r, esperaMs));
  }
  return null;
}
