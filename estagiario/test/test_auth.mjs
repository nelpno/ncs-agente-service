// test_auth.mjs — auth custom leve: senha (scrypt), cookie HMAC, convite, rate-limit, guarda de sessão.
// Funções puras, sem rede. SESSION_SECRET setado ANTES do import (config lê env no import).
import assert from "node:assert";
process.env.SESSION_SECRET = "test-secret-please-change";

const auth = await import("../src/auth.mjs");
let ok = 0;

// --- senha (scrypt) ---
{
  const a = auth.hashSenha("abc");
  const b = auth.hashSenha("abc");
  assert.notStrictEqual(a.hash, b.hash, "salt aleatório → hashes distintos");
  assert.notStrictEqual(a.salt, b.salt);
  assert.ok(auth.verificarSenha("abc", a.hash, a.salt), "senha correta → true");
  assert.ok(!auth.verificarSenha("errada", a.hash, a.salt), "senha errada → false");
  assert.ok(!auth.verificarSenha("abc", null, null), "sem hash/salt → false (não lança)");
  ok++;
}

// --- cookie HMAC ---
{
  const exp = Date.now() + 60000;
  const c = auth.assinarCookie({ uid: "u1", exp, sv: 1 });
  const v = auth.verificarCookie(c);
  assert.strictEqual(v.uid, "u1");
  assert.strictEqual(v.sv, 1);
  // adulterado (flip 1º char do payload → HMAC não bate)
  const tampered = (c[0] === "a" ? "b" : "a") + c.slice(1);
  assert.strictEqual(auth.verificarCookie(tampered), null, "cookie adulterado → null");
  // expirado
  const cexp = auth.assinarCookie({ uid: "u1", exp: Date.now() - 1000, sv: 1 });
  assert.strictEqual(auth.verificarCookie(cexp), null, "cookie expirado → null");
  // lixo
  assert.strictEqual(auth.verificarCookie("garbage"), null);
  assert.strictEqual(auth.verificarCookie(""), null);
  assert.strictEqual(auth.verificarCookie(null), null);
  ok++;
}

// --- convite ---
{
  const cv = auth.novoConvite();
  assert.strictEqual(cv.token.length, 64, "32 bytes hex → 64 chars");
  assert.strictEqual(auth.hashToken(cv.token), cv.tokenHash, "hashToken bate com tokenHash");
  assert.ok(new Date(cv.expira).getTime() > Date.now(), "expira no futuro");
  ok++;
}

// --- rate-limit (por email, em memória) ---
{
  const email = "rate@test.com";
  auth.resetRate(email);
  for (let i = 0; i < 5; i++) {
    assert.ok(auth.rateLogin(email), `tentativa ${i + 1} permitida`);
    auth.registrarFalha(email);
  }
  assert.ok(!auth.rateLogin(email), "6ª bloqueada após 5 falhas");
  auth.resetRate(email);
  assert.ok(auth.rateLogin(email), "resetRate libera");
  ok++;
}

// --- guarda de sessão (papel vem do BANCO, não do cookie) ---
{
  const exp = Date.now() + 60000;
  const u = { id: "u1", papel: "admin", nome: "Nelson", ativo: true, sessao_versao: 3 };
  const buscar = async (id) => (id === "u1" ? u : null);
  const cookieOk = auth.assinarCookie({ uid: "u1", exp, sv: 3 });
  const s = await auth.carregarSessao(cookieOk, buscar);
  assert.strictEqual(s.papel, "admin");
  assert.strictEqual(s.nome, "Nelson");
  assert.strictEqual(s.uid, "u1");
  assert.strictEqual(s.sv, 3, "sv volta do banco (p/ renovar cookie)");
  // inativo → null
  assert.strictEqual(await auth.carregarSessao(cookieOk, async () => ({ ...u, ativo: false })), null);
  // sessao_versao diferente (cookie velho, sv=2) → null
  const cookieVelho = auth.assinarCookie({ uid: "u1", exp, sv: 2 });
  assert.strictEqual(await auth.carregarSessao(cookieVelho, buscar), null, "sv mismatch → null");
  // cookie inválido → null
  assert.strictEqual(await auth.carregarSessao("garbage", buscar), null);
  // usuário não encontrado → null
  const cookieGhost = auth.assinarCookie({ uid: "ghost", exp, sv: 1 });
  assert.strictEqual(await auth.carregarSessao(cookieGhost, buscar), null);
  ok++;
}

// --- anti-enumeração: verificarSenhaDummy sempre false e nunca lança ---
{
  assert.strictEqual(auth.verificarSenhaDummy("qualquer"), false);
  assert.strictEqual(auth.verificarSenhaDummy(""), false);
  ok++;
}

// --- cookie com assinatura multibyte não estoura (fecha em null) ---
{
  assert.strictEqual(auth.verificarCookie("abc.café"), null);
  assert.strictEqual(auth.verificarCookie("p." + "é".repeat(10)), null);
  ok++;
}

console.log(`test_auth: ${ok}/7 OK`);
