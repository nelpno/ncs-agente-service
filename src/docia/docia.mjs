// docia.mjs — orquestra a análise. É o ÚNICO ponto de entrada do módulo.
//
// Hoje quem chama é a tool `analisar_contrato` da Ana (morador manda no WhatsApp). O upload presencial
// pelo Portal (equipe digitaliza) será um SEGUNDO chamador desta MESMA função — o serviço é um só,
// os pontos de entrada é que variam (§4a da arquitetura).
//
// Ordem dos passos não é enfeite:
//   1. legibilidade ANTES da extração — foto ruim vira pedido de reenvio na hora, sem gastar chamada
//      e, principalmente, sem virar pendência jurídica silenciosa ("não achei a assinatura" quando na
//      verdade não deu para LER a página).
//   2. verificar evidências ANTES de conferir — o checklist só julga o que foi provado.
//   3. o laudo é INFORMATIVO na Fase 0: não bloqueia o rascunho, não aprova nada, não dispara escrita.

import { randomUUID } from 'node:crypto';
import { lerDossie, extrairCampos, validarPeca } from './extrair.mjs';
import { verificarEvidencias, montarLaudo, salvarLaudo, resumirParaAgente } from './laudo.mjs';
import { conferir } from './conferir.mjs';
import { sbEnabled } from '../db_ncs.mjs';
import { config } from '../config.mjs';

const BUCKET = process.env.DOCIA_BUCKET || 'contratos';

const MSG = {
  sem_gemini: 'A leitura de documentos está indisponível no momento.',
  formato: 'Não recebi o arquivo direito.',
  tipo: 'Esse tipo de arquivo eu não consigo abrir. Manda foto (JPG/PNG) ou PDF, por favor.',
  grande: 'O arquivo é grande demais. Manda em fotos separadas, uma página por vez.',
  ilegivel: 'Não consegui ler o documento — a imagem saiu embaçada ou cortada. Consegue tirar de novo, mais de perto e com boa luz, mostrando a página inteira?',
  vazio: 'Não consegui extrair nada do arquivo.',
  json_invalido: 'Tive um problema para organizar os dados do contrato.',
  http: 'A leitura de documentos falhou agora.',
  erro: 'A leitura de documentos falhou agora.',
};
const falha = (motivo, extra = {}) => ({ ok: false, motivo, mensagem: MSG[motivo] || MSG.erro, ...extra });

/** Guarda o original no bucket PRIVADO. Nunca URL pública: o Portal emite signed URL curta na hora do clique. */
async function guardarArquivo(peca, id, i, { fetchImpl = fetch } = {}) {
  const ext = ({ 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' })[peca.mime] || 'bin';
  const d = new Date();
  const path = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${id}-p${i + 1}.${ext}`;
  const hash = 'sha256:' + (await import('node:crypto')).createHash('sha256').update(peca.buf).digest('hex');
  if (!sbEnabled()) return { storage_path: null, hash, bytes: peca.buf.length, guardado: false, motivo: 'sem_supabase' };
  try {
    const r = await fetchImpl(`${config.supabaseUrl}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        apikey: config.supabaseServiceKey,
        Authorization: `Bearer ${config.supabaseServiceKey}`,
        'Content-Type': peca.mime,
        'x-upsert': 'true',
      },
      body: peca.buf,
      signal: AbortSignal.timeout(config.sbTimeoutMs || 20000),
    });
    if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 160)}`);
    return { storage_path: `${BUCKET}/${path}`, hash, bytes: peca.buf.length, guardado: true };
  } catch (e) {
    // O arquivo não guardar não pode derrubar a análise — mas TEM que aparecer no laudo (nunca falha calada).
    console.warn('[docia] guardarArquivo falhou:', e.message);
    return { storage_path: null, hash, bytes: peca.buf.length, guardado: false, motivo: 'erro', detalhe: e.message };
  }
}

/**
 * Analisa o dossiê (1 PDF ou N fotos) e devolve o laudo.
 * @param {Array<{mime:string,buf:Buffer,nome?:string}>} pecas
 * @param {object} contexto  { hoje, erp:{...}|null, informado:{cpf}, origem:{canal,conv} }
 * @returns {Promise<{ok:boolean, laudo?:object, resumo?:object, motivo?:string, mensagem?:string}>}
 */
export async function analisarContrato(pecas, contexto = {}, io = {}) {
  const fetchImpl = io.fetchImpl || fetch;
  const lista = (Array.isArray(pecas) ? pecas : [pecas]).filter(Boolean);
  if (!lista.length) return falha('formato');

  for (const p of lista) {
    const v = validarPeca(p);
    if (!v.ok) return falha(v.motivo, { mime: v.mime });
  }

  // 1. PASSO 1 (visão): transcrição fiel + fatos visuais.
  const leitura = await (io.lerDossie || lerDossie)(lista, { fetchImpl });
  if (!leitura.ok) return falha(leitura.motivo, { detalhe: leitura.detalhe });

  // 2. GATE DE LEGIBILIDADE — antes de gastar a extração.
  const legiveis = leitura.paginas.filter((p) => p.legibilidade !== 'ilegivel');
  if (!legiveis.length) {
    return { ok: false, motivo: 'ilegivel', mensagem: MSG.ilegivel, paginas: leitura.paginas.length };
  }

  // 3. PASSO 2 (texto): campos com âncora. Não enxerga o papel — só a transcrição.
  const ext = await (io.extrairCampos || extrairCampos)(leitura.fonte, { fetchImpl });
  if (!ext.ok) return falha(ext.motivo, { detalhe: ext.detalhe });

  // 4. VERIFICADOR: o que não está ancorado na transcrição não existe.
  const { extracao, descartados } = verificarEvidencias(ext.extracao, leitura.fonte);

  // 5. JULGAMENTO determinístico.
  const veredito = conferir({ ...extracao, paginas: leitura.paginas }, {
    hoje: contexto.hoje || new Date(),
    erp: contexto.erp ?? null,
    informado: contexto.informado || {},
  });

  // 6. Guarda os originais e persiste o laudo canônico.
  const id = randomUUID();
  const arquivos = [];
  for (let i = 0; i < lista.length; i++) {
    const a = await guardarArquivo(lista[i], id, i, { fetchImpl });
    arquivos.push({ ...a, nome: lista[i].nome || null, mime: lista[i].mime });
  }

  const laudo = montarLaudo({
    id, extracao, veredito, paginas: leitura.paginas, arquivos,
    origem: contexto.origem || {}, descartados,
    modelo: process.env.DOCIA_VISION_MODEL || process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash',
    uso: { leitura: leitura.uso, extracao: ext.uso },
  });
  const persistido = await (io.salvarLaudo || salvarLaudo)(laudo, { fetchImpl });

  return { ok: true, laudo, resumo: resumirParaAgente(laudo), persistido: persistido.ok };
}
