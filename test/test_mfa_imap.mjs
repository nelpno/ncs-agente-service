// Leitura do código de MFA do painel Superlógica (src/mfa_imap.mjs). Hermético: só as funções puras
// (o IMAP em si exige caixa real e credencial; fica fora do gate de propósito).
//
// Por que este teste existe: a 1ª versão do decodeQP usava String.fromCharCode nos `=XX`, o que
// virava mojibake ("código" → "cÃ³digo"), o rótulo deixava de casar e a renovação DESCARTAVA um
// e-mail que estava na caixa — falhando com "código não chegou". Silencioso e enganoso.
import { decodeQP, extrairCodigo } from '../src/mfa_imap.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FALHOU:', m); } };

// corpo REAL do e-mail (quoted-printable, UTF-8), incluindo soft break no meio de uma palavra
const REAL = 'Seu c=C3=B3digo de verifica=C3=A7=C3=A3o =C3=A9: =20 021867 =20 Insira o c=\r\n=C3=B3digo acima no campo de verifica=C3=A7=C3=A3o. O c=C3=B3digo expira em 10 minutos.';

ok(decodeQP(REAL).includes('código de verificação'), 'decodeQP deveria devolver UTF-8 legível (mojibake volta a quebrar a leitura): ' + decodeQP(REAL).slice(0, 40));
ok(!decodeQP(REAL).includes('Ã'), 'decodeQP com mojibake');
ok(decodeQP('linha=\r\nquebrada') === 'linhaquebrada', 'soft break do quoted-printable não removido');
ok(extrairCodigo(REAL) === '021867', 'código não extraído do corpo real: ' + extrairCodigo(REAL));

// tolerância a variações de acento/encoding do rótulo
ok(extrairCodigo('Seu codigo de verificacao e: 123456') === '123456', 'rótulo sem acento');
ok(extrairCodigo('Seu c=C3=B3digo de verifica=C3=A7=C3=A3o: 654321') === '654321', 'rótulo sem o "é"');

// NUNCA chutar número solto: o e-mail tem protocolo, ano, id
ok(extrairCodigo('Protocolo 998877 gerado em 2026 pelo sistema') === null, 'extraiu número sem rótulo de verificação');
ok(extrairCodigo('') === null && extrairCodigo(null) === null, 'corpo vazio deveria ser null');
ok(extrairCodigo('Seu código de verificação é: 12345') === null, 'aceitou código com 5 dígitos');

// o primeiro código do corpo é o válido (o texto repete a palavra depois)
ok(extrairCodigo('código de verificação é: 111111 ... verificação 222222') === '111111', 'pegou o código errado quando há dois');

console.log(`\ntest_mfa_imap: ${pass} OK, ${fail} FALHOU`);
if (fail) process.exit(1);
