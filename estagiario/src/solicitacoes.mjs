// solicitacoes.mjs — fila espelhada dos tickets do Octadesk (tabela `solicitacoes`, espelho PASSIVO
// escrito por agente-service/src/espelho.mjs). Só LEITURA aqui: o Portal apenas mostra, quem grava é
// o worker do espelho. Clona o padrão de pendencias.mjs (mesmo par gate+listagem).
import * as realDb from "./db.mjs";

// Gate: além de owner/admin (igual pendências), funcionário também vê — é fila operacional de
// triagem (protocolo/tipo/setor/assunto/status), sem PII sensível (a linha nunca guarda telefone/
// CPF/e-mail — ver espelho.mjs), então faz sentido pra quem atende no dia a dia, não só gestão.
export function podeVerSolicitacoes(sess) {
  return !!(sess && ["owner", "admin", "funcionario"].includes(sess.papel));
}

// Só os campos estruturados que a tela usa — nunca `raw` (jsonb cru do ticket) nem `octadesk_id`/`id`.
// `origem` ('ana' | 'octadesk') deixa o Portal distinguir a linha própria da Ana (F1) da espelhada do Octa.
const SELECT = "protocolo_ncs,octadesk_number,origem,tipo,setor,assunto,status,requester,criado_em,atualizado_em";

export async function listarSolicitacoes({ tipo, status } = {}, db = realDb) {
  let q = `select=${SELECT}&order=criado_em.desc&limit=200`;
  if (tipo) q += `&tipo=eq.${encodeURIComponent(tipo)}`;
  if (status) q += `&status=eq.${encodeURIComponent(status)}`;
  return db.sbSelect("solicitacoes", q);
}
