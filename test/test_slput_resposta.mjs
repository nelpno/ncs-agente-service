// test_slput_resposta.mjs — a Superlógica sinaliza ERRO com HTTP 206 + corpo [{status:"500",msg}].
// avaliarResposta faz o slPut não reportar "gravou" quando NÃO gravou (bug do teste controlado 23/07).
import assert from 'node:assert';
import { avaliarResposta } from '../src/superlogica_write.mjs';
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// sucesso real: HTTP 200 + corpo status "200"
{
  const v = avaliarResposta(true, [{ status: '200', msg: ' 111 APTO - Sucesso', id_contato_con: '51050' }]);
  ok(v.ok === true, 'HTTP 200 + status 200 no corpo = sucesso');
}
// 🎯 o bug: HTTP 206 (r.ok=true) MAS corpo status 500 = ERRO (não pode virar "gravou")
{
  const v = avaliarResposta(true, [{ status: '500', msg: 'Número da unidade não informada.' }]);
  ok(v.ok === false, 'HTTP 206 + status 500 no corpo = ERRO (mesmo com httpOk=true)');
  ok(v.statusApi === '500', 'expõe o statusApi do corpo (500)');
  ok(/unidade/i.test(v.msg), 'expõe a msg de erro da API');
}
// "Não é permitido alterar o status do proprietário" (206) também é erro
{
  ok(avaliarResposta(true, [{ status: '500', msg: 'Não é permitido alterar o status do proprietário.' }]).ok === false, 'demote bloqueado = erro');
}
// corpo sem campo status + HTTP ok = sucesso (não inventa erro)
{
  ok(avaliarResposta(true, { id_unidade_uni: '11826' }).ok === true, 'corpo sem status + httpOk = sucesso');
  ok(avaliarResposta(true, 'texto qualquer').ok === true, 'corpo string + httpOk = sucesso');
}
// HTTP não-ok = erro, independente do corpo
{
  ok(avaliarResposta(false, [{ status: '200' }]).ok === false, 'httpOk=false = erro (rede/500 http)');
}

console.log(`test_slput_resposta: ${n}/${n} OK`);
