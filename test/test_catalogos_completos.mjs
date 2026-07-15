// test_catalogos_completos.mjs — determinístico, sem LLM, sem rede.
// Guarda de LOTE contra 2 regressões que já aconteceram de verdade e só apareceram em produção:
//
// 1) 58ca0d1 (13/07) regenerou os catálogos SEM o bloco `condominio` → o fallback de
//    gerar-lib.mjs:53 (`cad = cadastro || dados.condominio`) ficou sem dado → Superlógica fora
//    do ar = a equipe não emitia NENHUMA advertência/multa. Reposto em 89d58da.
// 2) 6052d97 (14/07) corrigiu `superlogica_nome` de 3 condos direto no JSON — mas o extrator
//    monta esse campo a partir de `data/regimentos/<slug>/_meta.json` ("condominio"), que ficou
//    com o nome ERRADO: re-extrair reintroduziria o bug. Metas corrigidos junto com este teste.
//
// O extrator SOBRESCREVE o JSON inteiro a cada re-extração → quem protege é este teste + o
// _meta.json certo, não a memória de quem rodar o comando.
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DADOS = path.join(RAIZ, "gerador", "dados");
const REGIMENTOS = path.join(RAIZ, "data", "regimentos");
let ok = 0, total = 0;
const check = (c, m) => { total++; assert(c, m); ok++; };

const arquivos = fs.readdirSync(DADOS).filter((f) => f.endsWith(".json"));
check(arquivos.length > 0, "nenhum catálogo em gerador/dados");

const semBloco = [], blocoIncompleto = [], metaDivergente = [];
for (const f of arquivos) {
  const slug = f.replace(/\.json$/, "");
  const d = JSON.parse(fs.readFileSync(path.join(DADOS, f), "utf8"));

  // (1) bloco de cadastro = fallback quando o Superlógica não responde
  if (!d.condominio?.nome) { semBloco.push(slug); continue; }
  // endereço é o que o cabeçalho do documento imprime — bloco pela metade não salva ninguém
  if (!d.condominio.endereco) blocoIncompleto.push(slug);

  // (2) o campo que o extrator vai reescrever tem de bater com a sua fonte
  const meta = path.join(REGIMENTOS, slug, "_meta.json");
  if (d.superlogica_nome && fs.existsSync(meta)) {
    const m = JSON.parse(fs.readFileSync(meta, "utf8"));
    if (m.condominio && m.condominio !== d.superlogica_nome) {
      metaDivergente.push(`${slug}: _meta="${m.condominio}" × catálogo="${d.superlogica_nome}"`);
    }
  }
}

check(semBloco.length === 0,
  `catálogo SEM bloco "condominio" (ERP fora = documento nenhum; rode gerador-documentos/repor-cadastro.mjs APPLY=1): ${semBloco.join(", ")}`);
check(blocoIncompleto.length === 0,
  `bloco "condominio" sem endereco (o cabeçalho do documento precisa dele): ${blocoIncompleto.join(", ")}`);
check(metaDivergente.length === 0,
  `_meta.json divergente — re-extrair reintroduz o nome errado (corrija o _meta, não só o catálogo):\n    ${metaDivergente.join("\n    ")}`);

console.log(`test_catalogos_completos: ${ok}/${total} OK (${arquivos.length} catálogos)`);
