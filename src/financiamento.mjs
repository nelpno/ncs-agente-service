// financiamento.mjs — condomínios/unidades com FINANCIAMENTO externo (ex.: reforma via 6P Bank no Vancouver)
// cuja dívida NÃO aparece no Superlógica. Guard anti-alucinação (mesmo padrão de garantidora.mjs):
// a Ana NUNCA declara quitação (CND) nem crava "em dia" onde há financiamento externo pendente.
//
// escopo 'condominio' = afeta o condomínio TODO (ponte, enquanto a lista de apartamentos não chegou).
// escopo 'unidades'  = afeta SÓ os id_unidade listados (versão precisa, quando a lista da 6P chegar).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'financiamento-6p.json'), 'utf8'));

// _matchFinanciamento: PURA/testável. Casa por id do condomínio; no escopo 'unidades' exige o id_unidade listado.
export function _matchFinanciamento({ id_condominio, id_unidade } = {}, db = DB) {
  const idc = id_condominio != null && id_condominio !== '' ? String(id_condominio) : null;
  if (!idc) return { afeta: false };
  const c = db.condominios && db.condominios[idc];
  if (!c) return { afeta: false };
  if (c.escopo === 'unidades') {
    const un = (c.unidades || []).map(String);
    if (id_unidade == null || id_unidade === '' || !un.includes(String(id_unidade))) return { afeta: false };
  }
  const inst = (db.instituicoes && db.instituicoes[c.instituicao]) || {};
  return {
    afeta: true,
    condominio: c.nome,
    instituicao: c.instituicao,
    canal: inst.canal || null,
    aviso: c.aviso || null,
    escopo: c.escopo,
  };
}

// consultar_financiamento: { afeta, condominio, instituicao, canal, aviso, escopo } ou { afeta:false }.
export function consultar_financiamento({ id_condominio, id_unidade } = {}) {
  return _matchFinanciamento({ id_condominio, id_unidade });
}
