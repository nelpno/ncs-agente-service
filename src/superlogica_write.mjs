// superlogica_write.mjs — escrita no Superlógica. PUT/POST só roda server-side, fora do alcance do $fromAI.
import { config } from './config.mjs';

const SL_TIMEOUT_MS = Number(process.env.SL_TIMEOUT_MS || 20000);

// credencial de ESCRITA (usuário de serviço); cai na de leitura só se não houver
function writeAuth() {
  return {
    app_token: config.slWriteApp || config.slApp,
    access_token: config.slWriteAccess || config.slAccess,
  };
}

// WRITE_REAL_ACTIONS — sair do DRY POR AÇÃO (não o DRY_RUN_WRITES global). Lista CSV de ids de ação
// (ex.: "titularidade") que gravam DE VERDADE mesmo com DRY_RUN_WRITES=true. Vazio (default) = tudo DRY.
// É como a Onda C ativa UMA ação (com OK do Fernando + teste controlado) sem destravar TODAS as escritas.
export function acaoGravaReal(actionId) {
  if (!actionId) return false;
  const allow = String(process.env.WRITE_REAL_ACTIONS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return allow.includes(actionId);
}

// Sucesso/erro a partir da resposta da Superlógica. Pura e exportada (testável sem rede).
// ⚠️ HTTP 2xx NÃO basta: erro vem como **HTTP 206** + corpo `[{status:"500", msg}]` (ex.: "Número da
// unidade não informada"). Provado no teste controlado de 23/07 — o slPut dava ok:true no 206 e a ação
// reportava "gravou" enquanto NADA era gravado (falha calada). Sucesso = corpo com status "2xx" (ou sem
// campo status, e r.ok). Qualquer outro status no corpo (500/…) é erro, mesmo com HTTP 2xx.
export function avaliarResposta(httpOk, resposta) {
  const primeiro = Array.isArray(resposta) ? resposta[0] : resposta;
  const statusApi = primeiro && typeof primeiro === 'object' ? String(primeiro.status ?? '') : '';
  const erroNoCorpo = statusApi !== '' && !/^2\d\d$/.test(statusApi);
  const msg = primeiro && typeof primeiro === 'object' ? primeiro.msg : undefined;
  return { ok: !!httpOk && !erroNoCorpo, statusApi: statusApi || undefined, msg };
}

export async function slPut(controllerAction, fields, method = 'PUT', actionId = null) {
  const real = acaoGravaReal(actionId);
  // DRY quando o global está ligado E esta ação NÃO está no allowlist de escrita real.
  if (config.dryRunWrites && !real) {
    console.log(`[slPut] DRY_RUN ${method} ${controllerAction} (${Object.keys(fields).length} campos)${actionId ? ' [' + actionId + ']' : ''}`);
    return { ok: true, dryRun: true, echo: fields };
  }
  // escrita real POR AÇÃO enquanto o global ainda é DRY = evento de auditoria (loga alto).
  if (config.dryRunWrites && real) console.warn(`[slPut] ⚠️ ESCRITA REAL via WRITE_REAL_ACTIONS: ${actionId} ${method} ${controllerAction}`);
  const url = `${config.slBase}/${controllerAction}`;
  const body = new URLSearchParams(fields).toString();
  const r = await fetch(url, {
    method,
    headers: { ...writeAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(SL_TIMEOUT_MS),
  });
  const texto = await r.text();
  let resposta;
  try {
    resposta = JSON.parse(texto);
  } catch {
    resposta = texto;
  }
  // HTTP 2xx não basta (ver avaliarResposta) — o status real vem do corpo.
  const v = avaliarResposta(r.ok, resposta);
  if (!v.ok) return { ok: false, status: r.status, statusApi: v.statusApi, msg: v.msg, resposta };
  return { ok: true, status: r.status, resposta };
}
