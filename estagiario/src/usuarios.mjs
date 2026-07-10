// usuarios.mjs — queries da tabela `usuarios` (spec §4.2/§4.4).
// Acesso via db.mjs (PostgREST + service_role). `db` injetável p/ teste.
// Regras de invalidação de sessão: reset de senha / reativação / reenvio de convite
// incrementam `sessao_versao` → derrubam cookies antigos daquela pessoa.
import * as realDb from "./db.mjs";
import { hashSenha, novoConvite, hashToken } from "./auth.mjs";

const enc = encodeURIComponent;
const normEmail = (e) => (e || "").trim().toLowerCase();

export async function porEmail(email, db = realDb) {
  const rows = await db.sbSelect("usuarios", `email=eq.${enc(normEmail(email))}&limit=1`);
  return rows[0] || null;
}

export async function porId(id, db = realDb) {
  const rows = await db.sbSelect("usuarios", `id=eq.${enc(id)}&limit=1`);
  return rows[0] || null;
}

export async function porTokenConvite(tokenHash, db = realDb) {
  const rows = await db.sbSelect("usuarios", `convite_token_hash=eq.${enc(tokenHash)}&limit=1`);
  return rows[0] || null;
}

// Cria a pessoa SEM senha, já com o convite (guarda só o hash). Devolve o token cru (nunca persistido).
export async function criarComConvite({ nome, email, papel = "funcionario" }, db = realDb) {
  const cv = novoConvite();
  const usuario = await db.sbInsert("usuarios", {
    nome,
    email: normEmail(email), // sempre lowercase (o /login normaliza igual) → sem conta que não loga / duplicada por case
    papel,
    ativo: true,
    convite_token_hash: cv.tokenHash,
    convite_expira: cv.expira,
  });
  return { usuario, token: cv.token };
}

// Define a senha no 1º acesso: grava hash+salt, invalida o convite, incrementa sessao_versao.
export async function ativar(id, senha, db = realDb) {
  const { hash, salt } = hashSenha(senha);
  const atual = await porId(id, db);
  const sv = (Number(atual?.sessao_versao) || 1) + 1;
  return db.sbUpdate("usuarios", `id=eq.${enc(id)}`, {
    senha_hash: hash,
    senha_salt: salt,
    convite_token_hash: null,
    sessao_versao: sv,
  });
}

export async function desativar(id, db = realDb) {
  return db.sbUpdate("usuarios", `id=eq.${enc(id)}`, { ativo: false });
}

export async function reativar(id, db = realDb) {
  const atual = await porId(id, db);
  const sv = (Number(atual?.sessao_versao) || 1) + 1;
  return db.sbUpdate("usuarios", `id=eq.${enc(id)}`, { ativo: true, sessao_versao: sv });
}

// "Reenviar convite" / "reset de senha" = regenera o link (mesmo mecanismo) + derruba cookies antigos.
export async function regenerarConvite(id, db = realDb) {
  const cv = novoConvite();
  const atual = await porId(id, db);
  const sv = (Number(atual?.sessao_versao) || 1) + 1;
  await db.sbUpdate("usuarios", `id=eq.${enc(id)}`, {
    convite_token_hash: cv.tokenHash,
    convite_expira: cv.expira,
    sessao_versao: sv,
  });
  return cv.token;
}

export async function tocarUltimoAcesso(id, db = realDb) {
  return db.sbUpdate("usuarios", `id=eq.${enc(id)}`, { ultimo_acesso: new Date().toISOString() });
}
