// test_mailer.mjs — prova o comportamento DRY (sem SMTP configurado, não envia; nunca lança).
import { enviarEmail, mailerStatus } from '../src/mailer.mjs';

let ok = 0, fail = 0;
const check = (n, c) => { if (c) ok++; else { fail++; console.log(`  ❌ ${n}`); } };

// garante estado DRY (sem envs)
delete process.env.MAIL_ENABLED;

const st = mailerStatus();
check('mailer começa DESABILITADO (DRY)', st.habilitado === false);

const r1 = await enviarEmail({ para: 'portaria@alarmsystem.com.br', assunto: 'teste', corpo: 'corpo' });
check('DRY → ok:true, dry:true, não envia', r1.ok === true && r1.dry === true);

const r2 = await enviarEmail({ para: 'sem-arroba', assunto: 'x', corpo: 'y' });
check('destinatário inválido → ok:false', r2.ok === false && r2.motivo === 'destinatario_invalido');

console.log(`\n${fail === 0 ? '✅' : '❌'} mailer: ${ok} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
