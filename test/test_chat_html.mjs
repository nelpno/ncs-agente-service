// test_chat_html.mjs — o JS da tela de teste da Ana (/chat) COMPILA?
//
// Bug real (15/07): `const t=buf.join('\n')` foi escrito dentro do CHAT_HTML, que é uma TEMPLATE
// STRING do server.mjs. O `\n` virou quebra de linha DE VERDADE no HTML servido → string não
// terminada → "Invalid or unexpected token" → o script inteiro morria → o botão Enviar não fazia
// nada. Ficou 2 dias assim (desde 09587c1) e NENHUM teste pegou: todos os smokes batem no
// /chat-send (a API) e nunca na TELA. O Fernando ia achar o bug ao vivo.
//
// Rede: importa o CHAT_HTML (o server tem guard de entrypoint → importar não sobe porta) e COMPILA
// o <script> com node:vm (compila sem executar). Escape quebrado = vermelho aqui.
import assert from "node:assert";
import vm from "node:vm";
import { CHAT_HTML } from "../server.mjs";

let ok = 0, total = 0;
const check = (c, m) => { total++; assert(c, m); ok++; };

check(CHAT_HTML.includes("<!DOCTYPE html>"), "CHAT_HTML gera HTML");
const js = (CHAT_HTML.match(/<script>([\s\S]*?)<\/script>/) || [])[1];
check(!!js, "a página tem <script>");

// o coração: o script servido tem que ser JS válido. vm.Script compila e NÃO executa.
let erro = null;
try { new vm.Script(js); } catch (e) { erro = e.message; }
check(erro === null, `o JS servido em /chat NÃO compila: ${erro}`);

// guard específico do bug: string partida por uma quebra de linha que era p/ ser um \n escapado
const quebradas = js.split("\n").filter((l) => {
  const semComentario = l.split("//")[0];
  return (semComentario.match(/'/g) || []).length % 2 === 1;
});
check(quebradas.length === 0,
  `linha com aspas ímpares (string partida — \\n virou quebra real): ${quebradas[0]?.trim().slice(0, 80)}`);

// os elementos que a pessoa usa
check(/id=["']?msg/.test(CHAT_HTML), "campo de mensagem (#msg) existe");
check(/id=["']?send/.test(CHAT_HTML), "botão Enviar (#send) existe");

console.log(`test_chat_html: ${ok}/${total} OK`);
