// autentique.mjs — integração com a API do Autentique (assinatura digital do CND OFICIAL).
// Doc oficial salva em docs/autentique-api.md. GraphQL multipart (graphql-multipart-request-spec).
//
// Env-gated: se AUTENTIQUE_TOKEN não estiver setado, fica INERTE e devolve { ok:false, motivo:'nao_configurado' }
// — nunca quebra o resto do agente. AUTENTIQUE_SANDBOX=true (padrão) cria documentos de teste (grátis,
// não dispara assinatura real, somem em dias). Virar a chave p/ produção = AUTENTIQUE_SANDBOX=false.
//
// Uso:
//   import { autentiqueConfigurado, enviarParaAssinatura } from './autentique.mjs';
//   const r = await enviarParaAssinatura({ pdfPath, nomeDocumento, signers: [{ email, name }] });
//   // r = { ok, documentId, sandbox, signatarios:[{name,email,link}], link } | { ok:false, motivo, detalhe }

import fs from 'node:fs';
import { config } from './config.mjs';

const ENDPOINT = config.autentiqueEndpoint || 'https://api.autentique.com.br/v2/graphql';

export function autentiqueConfigurado() {
  return !!config.autentiqueToken;
}

// Monta o array de signers da API a partir de uma lista amigável.
// Aceita { email, name?, phone?, via } onde via = 'email' (default) | 'whatsapp' | 'sms'.
function montarSigners(signers) {
  return (signers || []).map((s) => {
    const base = { action: 'SIGN' };
    if (s.name) base.name = s.name;
    const via = (s.via || (s.phone && !s.email ? 'whatsapp' : 'email')).toLowerCase();
    if (via === 'whatsapp' && s.phone) return { ...base, phone: s.phone, delivery_method: 'DELIVERY_METHOD_WHATSAPP' };
    if (via === 'sms' && s.phone) return { ...base, phone: s.phone, delivery_method: 'DELIVERY_METHOD_SMS' };
    return { ...base, email: s.email }; // e-mail é o padrão
  });
}

/**
 * Cria um documento no Autentique e solicita assinatura.
 * @param {object} p
 * @param {string} [p.pdfPath]      caminho do PDF no disco (ou use pdfBuffer)
 * @param {Buffer} [p.pdfBuffer]    conteúdo do PDF (alternativa ao pdfPath)
 * @param {string} p.nomeDocumento  nome do documento no Autentique (ex.: "Declaração de Quitação - Apto 12")
 * @param {Array}  p.signers        [{ email?, name?, phone?, via? }]
 * @param {string} [p.filename]     nome do arquivo enviado (default: documento.pdf)
 * @returns {Promise<{ok:true, documentId, sandbox, signatarios:Array<{name,email,link}>, link:string|null}
 *                   | {ok:false, motivo:string, detalhe?:string}>}
 */
export async function enviarParaAssinatura({ pdfPath, pdfBuffer, nomeDocumento, signers, filename } = {}) {
  if (!autentiqueConfigurado()) return { ok: false, motivo: 'nao_configurado', detalhe: 'AUTENTIQUE_TOKEN não definido — integração inerte.' };
  const lista = montarSigners(signers);
  if (!lista.length) return { ok: false, motivo: 'sem_signatario', detalhe: 'Nenhum signatário informado (e-mail ou telefone do síndico).' };

  let buf;
  try { buf = pdfBuffer || fs.readFileSync(pdfPath); }
  catch (e) { return { ok: false, motivo: 'pdf_invalido', detalhe: `Não consegui ler o PDF: ${e.message}` }; }

  const sandbox = config.autentiqueSandbox;
  const query = `mutation($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {`
    + ` createDocument(sandbox: ${sandbox ? 'true' : 'false'}, document: $document, signers: $signers, file: $file) {`
    + ` id name created_at signatures { public_id name email created_at link { short_link } } } }`;
  const operations = JSON.stringify({
    query,
    variables: { document: { name: nomeDocumento || 'Documento' }, signers: lista, file: null },
  });

  const fd = new FormData();
  fd.append('operations', operations);
  fd.append('map', JSON.stringify({ file: ['variables.file'] }));
  fd.append('file', new Blob([buf], { type: 'application/pdf' }), filename || 'documento.pdf');

  let resp, jr;
  try {
    resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.autentiqueToken}` },
      body: fd,
      signal: AbortSignal.timeout(45000),
    });
    jr = await resp.json().catch(() => null);
  } catch (e) {
    return { ok: false, motivo: 'erro_rede', detalhe: e.message };
  }
  if (!resp.ok || !jr) return { ok: false, motivo: 'http_erro', detalhe: `status ${resp?.status}` };
  if (jr.errors?.length) return { ok: false, motivo: 'graphql_erro', detalhe: jr.errors.map((e) => e.message).join('; ') };

  const doc = jr.data?.createDocument;
  if (!doc?.id) return { ok: false, motivo: 'resposta_inesperada', detalhe: JSON.stringify(jr).slice(0, 300) };

  const signatarios = (doc.signatures || []).map((s) => ({ name: s.name || null, email: s.email || null, link: s.link?.short_link || null }));
  return {
    ok: true,
    documentId: doc.id,
    nome: doc.name,
    sandbox,
    signatarios,
    link: signatarios.find((s) => s.link)?.link || null,
  };
}
