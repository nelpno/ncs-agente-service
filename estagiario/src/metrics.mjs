// metrics.mjs — agregações do painel do admin + custo R$ CALCULADO NA LEITURA (não congelado no banco).
// O custo em R$ é a COGS do dono (owner) → só entra quando comCusto=true (owner). Admin cliente vê uso, não custo.
// Preço por env MODEL_PRICE_<SLUG>="in/cached/out" (USD por Mtok); câmbio env USD_BRL. Modelo sem preço → fallback + warning.

const DEFAULT_PRICE = "2.50/0.25/15"; // gpt-5.4 (fallback conservador, USD/Mtok: input/cached/output)
const DEFAULT_USD_BRL = 5.4;

function envKey(modelo) {
  return "MODEL_PRICE_" + String(modelo || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
}
export function custoBRL({ prompt = 0, cached = 0, completion = 0, modelo }, env = process.env) {
  const usdBrl = Number(env.USD_BRL) || DEFAULT_USD_BRL;
  const preciso = env[envKey(modelo)];
  const raw = preciso || env.MODEL_PRICE_DEFAULT || DEFAULT_PRICE;
  const [pin, pcached, pout] = raw.split("/").map(Number);
  const promptFull = Math.max(0, (prompt || 0) - (cached || 0)); // prompt inclui os cached
  const usd = (promptFull * pin + (cached || 0) * pcached + (completion || 0) * pout) / 1e6;
  return { usd, brl: usd * usdBrl, warning: preciso ? null : `sem preço p/ modelo "${modelo}" — usando fallback` };
}

const custoLinha = (r, env) => custoBRL({ prompt: r.tokens_prompt, cached: r.tokens_cached, completion: r.tokens_completion, modelo: r.modelo }, env).brl;
function diaBRT(iso) { try { return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }); } catch { return String(iso || "").slice(0, 10); } }

export function resumoPeriodo(rows = [], env = process.env) {
  let brl = 0, documentos = 0; const pessoas = new Set();
  for (const r of rows) { brl += custoLinha(r, env); if (r.gerou_doc) documentos++; if (r.usuario_id) pessoas.add(r.usuario_id); }
  return { interacoes: rows.length, custoBRL: brl, documentos, pessoasAtivas: pessoas.size };
}

function contarPor(rows, chave, rotuloNulo) {
  const m = new Map();
  for (const r of rows) { const k = r[chave] || rotuloNulo; m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].map(([k, n]) => ({ [chave]: k, n })).sort((a, b) => b.n - a.n);
}
export const porTag = (rows = []) => contarPor(rows, "tag", "outro");
export const porCondominio = (rows = []) => contarPor(rows, "condominio", "(sem condomínio)");

export function porPessoa(rows = [], env = process.env, { comCusto = false, nomes = {}, papeis = {} } = {}) {
  const by = new Map();
  for (const r of rows) {
    const id = r.usuario_id || "?";
    let g = by.get(id);
    if (!g) { g = { usuario_id: id, nome: nomes[id] || null, papel: papeis[id] || null, interacoes: 0, documentos: 0, _dias: new Set(), _brl: 0, ultimaAtividade: null }; by.set(id, g); }
    g.interacoes++;
    if (r.gerou_doc) g.documentos++;
    g._dias.add(diaBRT(r.criado_em));
    g._brl += custoLinha(r, env);
    if (!g.ultimaAtividade || r.criado_em > g.ultimaAtividade) g.ultimaAtividade = r.criado_em;
  }
  return [...by.values()].map((g) => {
    const out = { usuario_id: g.usuario_id, nome: g.nome, papel: g.papel, interacoes: g.interacoes, documentos: g.documentos, diasAtivos: g._dias.size, ultimaAtividade: g.ultimaAtividade };
    if (comCusto) out.custoBRL = g._brl; // SÓ owner
    return out;
  }).sort((a, b) => b.interacoes - a.interacoes);
}
