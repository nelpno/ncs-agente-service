// cnd.mjs — CND INFORMATIVA (Declaração de Quitação de Débitos) para a Ana entregar no chat.
// Reusa o motor determinístico do gerador (gerador/src/declaracao-quitacao.mjs) no tipo 'informativo'
// (sem assinatura, com selo "VIA INFORMATIVA"). Os GATES anti-alucinação já vivem no gerador:
// só gera p/ quem está 100% em dia (inadimplente / no_juridico / garantidora / indisponivel => NÃO gera).
//
// Como a Ana (diferente do boleto) gera o PDF na hora e não tem URL pública pronta, mantemos um store
// efêmero token->arquivo e servimos via GET /cnd/<token> (server.mjs). O adapter do Chatwoot baixa essa URL.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from './config.mjs';
import { gerarDeclaracaoQuitacao } from '../gerador/src/declaracao-quitacao.mjs';

const TTL_MS = 30 * 60 * 1000; // 30 min — tempo de sobra p/ o adapter baixar e postar
const store = new Map(); // token -> { path, expires }

function gc() { const now = Date.now(); for (const [k, v] of store) if (v.expires < now) store.delete(k); }

function registrarPdf(filePath) {
  gc();
  const token = crypto.randomBytes(16).toString('hex');
  store.set(token, { path: filePath, expires: Date.now() + TTL_MS });
  return token;
}

// Lido pelo server.mjs na rota GET /cnd/<token>. Devolve o buffer do PDF ou null (inválido/expirado/sumiu).
export function servirPdf(token) {
  gc();
  const v = store.get(token);
  if (!v || v.expires < Date.now()) return null;
  try { return fs.readFileSync(v.path); } catch { return null; }
}

// Gera o CND informativo p/ a unidade e devolve { ok, url, filename } pronto p/ anexar, ou { ok:false, motivo }.
export async function gerarCndInformativo({ id_condominio, id_unidade } = {}) {
  const r = await gerarDeclaracaoQuitacao({ id_condominio, id_unidade, tipo: 'informativo' });
  if (!r.ok) {
    return { ok: false, motivo: r.motivo, detalhe: r.detalhe, ...(r.qtd_cobrancas_em_aberto != null ? { qtd_cobrancas_em_aberto: r.qtd_cobrancas_em_aberto } : {}) };
  }
  const token = registrarPdf(r.destino);
  return {
    ok: true,
    url: `${config.publicBase}/cnd/${token}`,
    filename: `Declaracao-Quitacao-${id_condominio}-${id_unidade}.pdf`,
    condominio: r.dados?.condominio?.nome || null,
  };
}
