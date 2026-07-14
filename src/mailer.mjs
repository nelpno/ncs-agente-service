// mailer.mjs — envio de e-mail dos avisos automáticos (portaria / garantidora).
// DRY por padrão: SÓ envia de verdade quando o SMTP estiver configurado (MAIL_ENABLED=true + SMTP_*).
// Assim o código já fica pronto; segunda, quando o Rodrigo criar atendimentoncs@gruponcs.net, é só ligar as envs.
// nodemailer é importado LAZY (só quando habilitado) — o caminho DRY não depende dele.

function habilitado() {
  return process.env.MAIL_ENABLED === 'true'
    && !!process.env.SMTP_HOST && !!process.env.SMTP_USER && !!process.env.SMTP_PASS;
}

let _transport = null;
async function getTransport() {
  if (_transport) return _transport;
  const nodemailer = (await import('nodemailer')).default;
  _transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return _transport;
}

/** enviarEmail({ para, assunto, corpo, de? }) → { ok, dry, id?, para, assunto }. Nunca lança: erro vira {ok:false}. */
export async function enviarEmail({ para, assunto, corpo, de } = {}) {
  if (!para || !/@/.test(para)) return { ok: false, motivo: 'destinatario_invalido', para };
  if (!habilitado()) {
    console.log(`[mailer] DRY — e-mail NÃO enviado (SMTP off): para=${para} | assunto="${assunto}"`);
    return { ok: true, dry: true, para, assunto };
  }
  try {
    const t = await getTransport();
    const from = de || process.env.MAIL_FROM || process.env.SMTP_USER;
    const info = await t.sendMail({ from, to: para, subject: assunto, text: corpo });
    return { ok: true, dry: false, id: info.messageId, para, assunto };
  } catch (e) {
    console.warn('[mailer] falha no envio:', e.message);
    return { ok: false, motivo: 'erro_smtp', detalhe: e.message, para, assunto };
  }
}

export function mailerStatus() {
  return { habilitado: habilitado(), host: process.env.SMTP_HOST || null, from: process.env.MAIL_FROM || process.env.SMTP_USER || null };
}
