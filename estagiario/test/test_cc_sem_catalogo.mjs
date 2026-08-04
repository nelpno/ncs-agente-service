// test_cc_sem_catalogo.mjs — notificação pelo CÓDIGO CIVIL não pode depender do catálogo de infrações
// do condomínio.
//
// Caso real (print do Fernando, 24/07): o Estagiário redigiu a minuta do Mario de Andrade citando o
// Art. 1.336, IV — e na hora de gerar o arquivo respondeu "o condomínio não está disponível no
// sistema... não consigo gerar nem em Word nem em PDF". O condomínio ESTÁ no sistema; o que falta é o
// catálogo de infrações (ele nunca teve Regimento Interno — só a convenção; o `_meta.json` registra
// isso). Só que a rota do Código Civil NÃO USA o catálogo: o artigo vem da lei e o cadastro vem do
// Superlógica. O bloqueio era acidental — um `carregarCondominio` na primeira linha do gerar_documento,
// antes de decidir a base legal.
//
// Vale para todos os condomínios sem regimento, não só esse.
// Hermético: verificador (LLM) e Superlógica injetados.
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { gerar_documento, SAIDA } from "../src/documentos.mjs";

let ok = 0, total = 0;
const check = (c, m) => { total++; assert(c, m); ok++; };

const RELATO = "Em 23/07/2026, às 11h30, foi constatada ocorrência de som alto na unidade 18, "
  + "perturbando o sossego dos demais moradores.";

const chatSim = async () => ({ content: '{"cobre":"sim"}' });
// O ERP resolve o condomínio (ele existe lá) — é o catálogo que não existe.
const slOk = async () => ({
  encontrado: true, nome: "CONDOMINIO EDIFICIO MARIO DE ANDRADE",
  endereco: "RUA HUMAITA", cep: "14801000", cidade_uf: "ARARAQUARA/SP", cidade_fecho: "ARARAQUARA",
});

// --- fixture HERMÉTICA (04/08/2026): o teste NÃO pode depender de um condomínio real continuar sem
// catálogo. O caso do print era o Mario de Andrade, mas o Fernando autorizou catalogá-lo pela
// Convenção em 04/08 ("seguir como o Attuale") e hoje os 55 condomínios do RAG TÊM catálogo — o
// teste ficou vermelho sozinho, sem nenhuma regressão. O cenário continua valendo para todo
// condomínio que entrar sem catálogo, então uso um nome que comprovadamente não tem um; o ERP já é
// injetado (slOk), então nada aqui depende de dado real.
const SEM_CATALOGO = "Condominio Exemplo Sem Catalogo";
{
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
    "..", "..", "gerador", "dados");
  const slug = SEM_CATALOGO.toLowerCase().replace(/\s+/g, "-");
  check(!fs.existsSync(path.join(dir, `${slug}.json`)),
    `fixture: "${SEM_CATALOGO}" realmente não tem catálogo (se alguém criar um, troque o nome)`);
}

// --- 1) o que o Fernando tentou: notificação pelo CC num condomínio sem catálogo → GERA
{
  const out = await gerar_documento({
    condominio: SEM_CATALOGO, base_legal: "codigo_civil", tipo: "notificacao",
    destinatario: { nome: "Marcio Francisco Micheloni", genero: "M", apartamento: "18" },
    relato: RELATO, data_documento: "25 de julho de 2026",
  }, { chat: chatSim, resolverCondominio: slOk });

  check(out.ok === true, `condomínio sem catálogo deveria gerar pelo CC — veio ${JSON.stringify(out)}`);
  check(out.base_legal === "codigo_civil", "resultado marca base_legal codigo_civil");
  check(/\.doc$/.test(out.arquivo), `padrão é Word editável — veio ${out.arquivo}`);

  const doc = fs.readFileSync(path.join(SAIDA, out.arquivo), "utf8");
  check(/Código Civil \(Lei/.test(doc), "documento cita o Código Civil");
  check(doc.includes("MARIO DE ANDRADE"), "documento traz o cadastro que veio do ERP");
  try { fs.unlinkSync(path.join(SAIDA, out.arquivo)); } catch {}
}

// --- 2) PDF também (o "Word ou PDF" da pergunta dele)
{
  const out = await gerar_documento({
    condominio: SEM_CATALOGO, base_legal: "codigo_civil", tipo: "notificacao", formato: "pdf",
    destinatario: { nome: "Marcio Francisco Micheloni", genero: "M", apartamento: "18" },
    relato: RELATO, data_documento: "25 de julho de 2026",
  }, { chat: chatSim, resolverCondominio: slOk });
  check(out.ok === true && /\.pdf$/.test(out.arquivo || ""), `PDF pelo CC sem catálogo — veio ${JSON.stringify(out.motivo || out.erro || out.arquivo)}`);
  try { fs.unlinkSync(path.join(SAIDA, out.arquivo)); } catch {}
}

// --- 3) CONTROLE: sem catálogo NÃO se inventa multa por regimento. A recusa tem que explicar o que
//         falta (catálogo), não dizer que o condomínio não existe.
{
  const out = await gerar_documento({
    condominio: SEM_CATALOGO, tipo: "multa", infracao_id: "barulho",
    destinatario: { nome: "Marcio Francisco Micheloni", genero: "M", apartamento: "18" },
    relato: RELATO, data_documento: "25 de julho de 2026",
  }, { chat: chatSim, resolverCondominio: slOk });
  check(out.ok !== true, "multa pelo regimento num condomínio sem catálogo continua recusada");
  check(/cat[áa]logo/i.test(out.erro || out.detalhe || ""),
    `a recusa deve falar do catálogo (veio: ${out.erro || out.detalhe})`);
}

// --- 4) CONTROLE: condomínio COM catálogo segue funcionando pelo CC (não regredimos a rota boa)
{
  const out = await gerar_documento({
    condominio: "allure", base_legal: "codigo_civil", tipo: "notificacao",
    destinatario: { nome: "Ciclano", genero: "M", apartamento: "21" },
    relato: RELATO, data_documento: "25 de julho de 2026",
  }, { chat: chatSim, resolverCondominio: async () => ({ encontrado: false }) });
  check(out.ok === true, `condomínio com catálogo segue gerando pelo CC — veio ${JSON.stringify(out.motivo || out.erro)}`);
  try { fs.unlinkSync(path.join(SAIDA, out.arquivo)); } catch {}
}

console.log(`test_cc_sem_catalogo: ${ok}/${total} OK`);
