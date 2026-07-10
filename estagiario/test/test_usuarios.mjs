// test_usuarios.mjs — queries de usuário sobre db.mjs (db injetável, sem rede).
import assert from "node:assert";
process.env.SESSION_SECRET = "x";

const u = await import("../src/usuarios.mjs");
const { hashToken, verificarSenha } = await import("../src/auth.mjs");
let ok = 0;

function mkdb(overrides = {}) {
  const rec = [];
  return {
    rec,
    sbSelect: async (t, q) => { rec.push(["select", t, q]); return overrides.selectRows || []; },
    sbInsert: async (t, row) => { rec.push(["insert", t, row]); return { id: "new1", ...row }; },
    sbUpdate: async (t, q, patch) => { rec.push(["update", t, q, patch]); return [{ id: "u1", ...patch }]; },
  };
}

// porEmail monta filtro email=eq.
{
  const db = mkdb({ selectRows: [{ id: "u1", email: "a@b.c" }] });
  const r = await u.porEmail("a@b.c", db);
  assert.strictEqual(r.id, "u1");
  assert.ok(db.rec[0][2].includes("email=eq."), "filtro email=eq.");
  assert.strictEqual(await u.porEmail("some@one.com", mkdb({ selectRows: [] })), null, "vazio → null");
  ok++;
}

// porId e porTokenConvite montam filtros
{
  const db = mkdb({ selectRows: [{ id: "u1" }] });
  await u.porId("u1", db);
  assert.ok(db.rec[0][2].includes("id=eq.u1"));
  const db2 = mkdb({ selectRows: [{ id: "u1" }] });
  await u.porTokenConvite("abc123hash", db2);
  assert.ok(db2.rec[0][2].includes("convite_token_hash=eq.abc123hash"));
  ok++;
}

// criarComConvite: insere SEM senha, COM convite hash; devolve o token cru; hash bate com o token
{
  const db = mkdb();
  const { usuario, token } = await u.criarComConvite({ nome: "X", email: "x@y.z", papel: "admin" }, db);
  const [op, table, row] = db.rec[0];
  assert.strictEqual(op, "insert");
  assert.strictEqual(table, "usuarios");
  assert.strictEqual(row.senha_hash, undefined, "sem senha ainda");
  assert.strictEqual(row.papel, "admin");
  assert.ok(row.convite_token_hash, "hash de convite presente");
  assert.strictEqual(row.convite_expira && typeof row.convite_expira, "string");
  assert.strictEqual(token.length, 64, "token cru retornado");
  assert.strictEqual(hashToken(token), row.convite_token_hash, "hash gravado corresponde ao token");
  assert.ok(usuario.id, "usuário criado retornado");
  ok++;
}

// papel default = funcionario
{
  const db = mkdb();
  await u.criarComConvite({ nome: "Y", email: "y@z.w" }, db);
  assert.strictEqual(db.rec[0][2].papel, "funcionario");
  ok++;
}

// ativar: grava hash+salt válidos, zera convite, incrementa sessao_versao
{
  const db = mkdb({ selectRows: [{ id: "u1", sessao_versao: 4 }] });
  await u.ativar("u1", "senha-secreta", db);
  const upd = db.rec.find((r) => r[0] === "update");
  assert.ok(upd, "houve update");
  const patch = upd[3];
  assert.ok(patch.senha_hash && patch.senha_salt, "hash+salt gravados");
  assert.ok(await verificarSenha("senha-secreta", patch.senha_hash, patch.senha_salt), "senha confere");
  assert.strictEqual(patch.convite_token_hash, null, "convite invalidado");
  assert.strictEqual(patch.sessao_versao, 5, "sessao_versao 4→5");
  ok++;
}

// desativar → ativo=false; regenerarConvite → novo token + sessao_versao++
{
  const db = mkdb();
  await u.desativar("u1", db);
  assert.strictEqual(db.rec[0][3].ativo, false);

  const db2 = mkdb({ selectRows: [{ id: "u1", sessao_versao: 2 }] });
  const tok = await u.regenerarConvite("u1", db2);
  assert.strictEqual(tok.length, 64, "novo token cru");
  const upd = db2.rec.find((r) => r[0] === "update");
  assert.strictEqual(hashToken(tok), upd[3].convite_token_hash);
  assert.strictEqual(upd[3].sessao_versao, 3, "reset invalida cookies antigos (2→3)");
  ok++;
}

// tocarUltimoAcesso escreve ultimo_acesso
{
  const db = mkdb();
  await u.tocarUltimoAcesso("u1", db);
  assert.ok(db.rec[0][3].ultimo_acesso, "ultimo_acesso setado");
  ok++;
}

// e-mail normalizado (lowercase+trim) na criação e no filtro do porEmail (senão admin com maiúscula não loga)
{
  const db = mkdb();
  await u.criarComConvite({ nome: "Z", email: "  Fulano@GRUPONCS.NET " }, db);
  assert.strictEqual(db.rec[0][2].email, "fulano@gruponcs.net", "email lowercase+trim na criação");
  const db2 = mkdb({ selectRows: [] });
  await u.porEmail("Outro@X.COM", db2);
  assert.ok(db2.rec[0][2].includes("email=eq.outro%40x.com"), "porEmail filtra em lowercase");
  ok++;
}

// criarComSenha: usuário JÁ ativo, com hash+salt válidos, email lowercase, papel dado (bootstrap admin)
{
  const db = mkdb();
  await u.criarComSenha({ nome: "Nelson", email: "SUPER@Gruponcs.net", papel: "owner", senha: "senhaBootstrap1" }, db);
  const row = db.rec[0][2];
  assert.strictEqual(row.papel, "owner");
  assert.strictEqual(row.ativo, true);
  assert.strictEqual(row.email, "super@gruponcs.net");
  assert.ok(row.senha_hash && row.senha_salt, "senha gravada");
  assert.ok(await verificarSenha("senhaBootstrap1", row.senha_hash, row.senha_salt), "senha confere");
  assert.strictEqual(row.convite_token_hash, undefined, "sem convite (login direto)");
  ok++;
}

// listar: monta select com os campos do painel
{
  const db = mkdb({ selectRows: [{ id: "u1", nome: "A", papel: "admin" }] });
  const rows = await u.listar(db);
  assert.strictEqual(rows.length, 1);
  assert.ok(db.rec[0][2].includes("select="), "select de campos");
  ok++;
}

console.log(`test_usuarios: ${ok}/10 OK`);
