// pendencias.mjs — fila VISÍVEL do outbox de notificações (spec §4.3 do design da Onda 1).
// Mata as 2 falhas silenciosas atuais (JSONL que ninguém abre + console.warn): todo aviso
// (portaria/síndico/garantidora) que não saiu sozinho vira uma linha aqui, lida SÓ LEITURA.
import * as realDb from "./db.mjs";

// Gating puro (usado pelo server.mjs). Diferente de Aprovações (só pode_aprovar): aqui também
// entra owner/admin — já enxergam custo/config do sistema, faz sentido enxergarem falha operacional
// mesmo sem terem sido individualmente marcados como aprovadores. Documentado no spec §4.3 como
// "(ou admin — escolha coerente e documente)".
export function podeVerPendencias(sess) {
  return !!(sess?.podeAprovar || sess?.papel === "owner" || sess?.papel === "admin");
}

// Só o que precisa de atenção humana: enviado com sucesso não aparece aqui (spec §4.3 status enum).
const STATUS_FILA = "pendente_humano,falhou";

export async function listarPendentes(db = realDb) {
  return db.sbSelect("notificacoes", `status=in.(${STATUS_FILA})&order=criado_em.desc&select=*`);
}
