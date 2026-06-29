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

export async function slPut(controllerAction, fields, method = 'PUT') {
  if (config.dryRunWrites) {
    console.log(`[slPut] DRY_RUN ${method} ${controllerAction} (${Object.keys(fields).length} campos)`);
    return { ok: true, dryRun: true, echo: fields };
  }
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
  if (!r.ok) return { ok: false, status: r.status, resposta };
  return { ok: true, status: r.status, resposta };
}
