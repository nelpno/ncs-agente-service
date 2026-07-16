// zap.mjs — entrega dos avisos por WhatsApp (grupo da portaria / síndico) via ZuckZapGo.
// DESLIGADO por padrão e com ALLOWLIST obrigatória. Os dois são de propósito.
//
// Por que não fica ligado direto: o canal aqui é o Zuck (NÃO-oficial). A Cloud API oficial da Meta não
// entrega em GRUPO, e o não-oficial tem risco de ban no número (spec Onda 1 §5 — ainda em aberto). Enquanto
// o §5 não for decidido, este transporte serve ao ENSAIO: entrega só para JID que esteja explicitamente na
// ZAP_ALLOWLIST. Um condomínio de verdade não recebe por acidente — e "por acidente" não é hipótese remota:
// condomínio Humana roteia `sindico` → zap_individual, que é o celular PESSOAL do síndico.
//
// ⚠️ NUNCA finge envio (a regra do outbox.mjs). Desligado, sem chave, ou fora da allowlist → devolve
// { ok:false, semRetry:true } e o outbox marca 'pendente_humano' NA HORA — exatamente o que ele já fazia
// antes deste arquivo existir. Com ZAP_ENABLED != 'true' o comportamento do sistema é o de hoje, sem
// desvio: é isso que torna seguro este arquivo entrar em produção junto com o resto.
//
// (O mailer.mjs, no caminho DRY, devolve ok:true → a linha vira 'enviado'. Aqui isso seria mentira:
// o outbox passaria a dizer "avisei a portaria" sem ninguém ter recebido nada. Por isso os dois diferem.)

const BASE_PADRAO = 'https://zuck.dynamicagents.tech';

export function zapHabilitado() {
  return process.env.ZAP_ENABLED === 'true' && !!process.env.ZUCK_TOKEN;
}

/** Allowlist de destinos (JID de grupo ou número). Vazia = nada sai. Separada por vírgula. */
export function zapAllowlist() {
  return String(process.env.ZAP_ALLOWLIST || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
}

/** permitido(endereco) → bool. Match EXATO: substring deixaria "5516..." casar com outro número. */
export function zapPermitido(endereco) {
  const alvo = String(endereco || '').trim();
  if (!alvo) return false;
  return zapAllowlist().includes(alvo);
}

/**
 * enviarZap({ para, texto }) → { ok, dry?, motivo?, semRetry?, id?, para }
 *  - `para` = JID do grupo ("...@g.us") ou número. Nunca lança: erro vira { ok:false }.
 *  - semRetry:true → decisão de configuração (desligado / fora da lista), não falha transitória:
 *    re-tentar 5× não muda nada, então o outbox manda direto pra fila humana.
 */
export async function enviarZap({ para, texto } = {}) {
  const alvo = String(para || '').trim();
  if (!alvo) return { ok: false, motivo: 'destinatario_vazio', semRetry: true, para: alvo };
  if (!String(texto || '').trim()) return { ok: false, motivo: 'texto_vazio', semRetry: true, para: alvo };

  if (!zapHabilitado()) {
    // Mesma pendência que o outbox criava antes deste transporte existir — nome do motivo preservado
    // de propósito: quem lê a fila (ou um teste) não vê mudança nenhuma com a flag desligada.
    return { ok: false, motivo: 'transporte_zap_indefinido', semRetry: true, para: alvo };
  }
  if (!zapPermitido(alvo)) {
    return { ok: false, motivo: 'fora_da_allowlist', semRetry: true, para: alvo };
  }

  const base = (process.env.ZUCK_BASE || BASE_PADRAO).replace(/\/+$/, '');
  try {
    const r = await fetch(`${base}/chat/send/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token: process.env.ZUCK_TOKEN },
      body: JSON.stringify({ Phone: alvo, Body: texto }),
      signal: AbortSignal.timeout(Number(process.env.ZAP_TIMEOUT_MS || 20000)),
    });
    const corpo = await r.json().catch(() => null);
    if (!r.ok || corpo?.success === false) {
      return { ok: false, motivo: 'erro_zuck', detalhe: `HTTP ${r.status} ${corpo?.error || ''}`.trim(), para: alvo };
    }
    return { ok: true, dry: false, id: corpo?.data?.Id || null, para: alvo };
  } catch (e) {
    // Rede/timeout = transitório → SEM semRetry: o outbox re-tenta nas próximas passadas.
    return { ok: false, motivo: 'erro_zuck', detalhe: e.message, para: alvo };
  }
}

export function zapStatus() {
  return { habilitado: zapHabilitado(), base: process.env.ZUCK_BASE || BASE_PADRAO, allowlist: zapAllowlist() };
}
