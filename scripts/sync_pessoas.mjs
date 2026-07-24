// sync_pessoas.mjs — popula/atualiza o ÍNDICE GLOBAL `pessoas` (Supabase) a partir da API PÚBLICA v2.
// Espelho dos responsáveis de TODOS os condomínios → busca O(1) por CPF na Ana (src/pessoas.mjs),
// substituindo a varredura de 59 condos. Env-based: roda dentro do container da Ana (que já tem as vars):
//   docker exec ncs-agente node scripts/sync_pessoas.mjs
// Agende periódico (nightly) via cron no host. LGPD-mínimo: nunca cartão/banco/RG/nascimento.
const SL_BASE = process.env.SUPERLOGICA_BASE_URL || 'https://api.superlogica.net/v2/condor';
// token de ESCRITA vê 59 condos (vs 54 do read); cai pro read se o write não estiver setado.
const SL_H = {
  app_token: process.env.SUPERLOGICA_WRITE_APP_TOKEN || process.env.SUPERLOGICA_APP_TOKEN,
  access_token: process.env.SUPERLOGICA_WRITE_ACCESS_TOKEN || process.env.SUPERLOGICA_ACCESS_TOKEN,
  'Content-Type': 'application/json',
};
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const SB_H = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };
if (!SB_URL || !SB_KEY) { console.error('faltam SUPABASE_URL/SUPABASE_SERVICE_KEY'); process.exit(1); }

const digits = (s) => (s || '').toString().replace(/\D/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function slGet(ca, params) { const qs = new URLSearchParams(params).toString(); const r = await fetch(`${SL_BASE}/${ca}?${qs}`, { headers: SL_H, signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error(ca + ' ' + r.status); return r.json(); }
async function sbDelete(cond) { const r = await fetch(`${SB_URL}/rest/v1/pessoas?id_condominio=eq.${cond}`, { method: 'DELETE', headers: { ...SB_H, Prefer: 'return=minimal' }, signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error('del ' + r.status); }
async function sbInsert(rows) { for (let i = 0; i < rows.length; i += 500) { const r = await fetch(`${SB_URL}/rest/v1/pessoas`, { method: 'POST', headers: { ...SB_H, Prefer: 'return=minimal' }, body: JSON.stringify(rows.slice(i, i + 500)), signal: AbortSignal.timeout(45000) }); if (!r.ok) throw new Error('ins ' + r.status + ' ' + (await r.text()).slice(0, 120)); } }

const map = (r, cid, cnome) => {
  const cpf = digits(r.st_cpf_con), cnpj = digits(r.st_cgc_con), doc = cpf || cnpj || null;
  return {
    id_condominio: cid, condominio: cnome, id_contato: Number(r.id_contato_con) || null,
    id_unidade: Number(r.id_unidade_uni) || null, unidade: r.st_unidade_uni || null, bloco: r.st_bloco_uni || null,
    nome: r.st_nome_con || null, doc, doc_tipo: cpf ? 'cpf' : (cnpj ? 'cnpj' : null),
    papel: r.st_nometiporesp_tres || r.tipo || null, id_label: Number(r.id_label_tres) || null,
    email: r.st_email_con || null, telefone: r.st_telefone_con || r.st_celular_con || null,
    entrega_cobranca: r.fl_entregacobranca_resp != null ? String(r.fl_entregacobranca_resp) : null,
    ativo: !(r.dt_saida_res && String(r.dt_saida_res).trim()), dt_entrada: r.dt_entrada_res || null, dt_saida: r.dt_saida_res || null,
  };
};

async function umCondo(c, tent = 4) {
  for (let t = 0; t < tent; t++) {
    try {
      const data = await slGet('responsaveis/index', { idCondominio: c.id }); // SEM pagina = traz todos
      const rows = (Array.isArray(data) ? data : []).map((r) => map(r, c.id, c.nome));
      await sbDelete(c.id); if (rows.length) await sbInsert(rows);
      return { rows: rows.length, doc: rows.filter((r) => r.doc).length };
    } catch (e) { if (t === tent - 1) throw e; await sleep(2500 * (t + 1)); } // 503 transitório → backoff
  }
}

const condos = (await slGet('condominios/get', { id: -1 })).map((c) => ({ id: c.id_condominio_cond || c.id, nome: c.st_fantasia_cond || c.st_nome_cond || '' })).filter((c) => c.id);
console.log('condos:', condos.length);
let total = 0, comDoc = 0, erros = 0;
const CONC = 6;
for (let i = 0; i < condos.length; i += CONC) {
  await Promise.all(condos.slice(i, i + CONC).map(async (c) => {
    try { const r = await umCondo(c); total += r.rows; comDoc += r.doc; }
    catch (e) { erros++; console.error('ERRO condo', c.id, c.nome, e.message.slice(0, 80)); }
  }));
}
console.log(`SYNC OK | linhas: ${total} | com doc: ${comDoc} | condos com erro: ${erros}`);
process.exit(erros > condos.length / 3 ? 1 : 0); // falha só se muitos condos caírem (senão parcial ok)
