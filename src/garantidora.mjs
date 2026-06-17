// garantidora.mjs — condomínios cuja cobrança é feita por uma GARANTIDORA externa (não pelo Superlógica da NCS).
// Isolado e anti-alucinação (mesmo padrão de mudanca.mjs): a Ana NUNCA inventa garantidora nem canal.
// tipo 'total'  = NCS não gera nada pelo Superlógica → direcionar à garantidora (boleto/2ª via/inadimplência).
// tipo 'allure' = boleto normal a NCS gera; só a inadimplência (+30d vencido) e o judicial vão à garantidora.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'garantidoras.json'), 'utf8'));

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// _matchGarantidora: PURA/testável. Casa por id (preferido) ou, sem id no cadastro, por termos no nome.
export function _matchGarantidora({ id_condominio, nome } = {}, db = DB) {
  const idn = id_condominio != null && id_condominio !== '' ? String(id_condominio) : null;
  if (idn) {
    const byId = db.condominios.find((c) => c.id != null && String(c.id) === idn);
    if (byId) return byId;
  }
  const nomeN = norm(nome);
  if (nomeN) {
    const byNome = db.condominios.find((c) => Array.isArray(c.match) && c.match.every((t) => nomeN.includes(norm(t))));
    if (byNome) return byNome;
  }
  return null;
}

// consultar_garantidora: { tem, tipo, condominio, garantidora:{nome,whatsapp,telefone,email,site} } ou { tem:false }.
export function consultar_garantidora({ id_condominio, nome } = {}) {
  const c = _matchGarantidora({ id_condominio, nome });
  if (!c) return { tem: false };
  const g = DB.garantidoras[c.garantidora] || {};
  return { tem: true, tipo: c.tipo, condominio: c.nome, garantidora: { nome: c.garantidora, ...g } };
}
