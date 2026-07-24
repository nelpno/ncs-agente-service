// test_codigo_civil_documento.mjs — Pesquisa 2, Etapa 2 (decisão Fernando 23/07): GERAR a notificação
// citando o Código Civil quando o Regimento/Convenção do condomínio NÃO cobre a conduta.
// Determinístico e hermético: LLM (verificador) injetado, Superlógica injetado — roda no gate (env -i).
// O verificador vira o ROTEADOR: RI não cobre → oferece o CC; CC cobre → gera; CC também não → humano.
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { gerarDocumento, carregarCondominio } from "../../gerador/src/gerar-lib.mjs";
import { buscarArtigoCC } from "../../src/codigo_civil.mjs";
import { sugerirCodigoCivil, gerar_documento, SAIDA } from "../src/documentos.mjs";

let ok = 0, total = 0;
const check = (c, m) => { total++; assert(c, m); ok++; };

const RELATO_INFILTRACAO =
  "No dia 10/07 constatou-se infiltração proveniente da unidade superior, danificando o forro do banheiro da unidade inferior.";

// ── 1) buscarArtigoCC: acha o artigo do CC por tema, VERBATIM e SEM truncar (o documento cita a lei crua)
{
  const r = buscarArtigoCC({ tema: RELATO_INFILTRACAO, k: 3 });
  check(r.encontrou, "buscarArtigoCC deveria achar artigo p/ infiltração/dano");
  const funds = r.artigos.map((a) => a.fundamento);
  check(funds.every((f) => /Código Civil/i.test(f)), `fundamento deve citar Código Civil, veio [${funds}]`);
  check(funds.some((f) => /Art\.\s*1\.(319|336|344)/.test(f)), `esperava 1.319/1.336/1.344, veio [${funds}]`);
  check(r.artigos.every((a) => typeof a.texto === "string" && !a.texto.endsWith("…")), "texto do artigo NÃO pode vir truncado (verbatim)");
  const vazio = buscarArtigoCC({ tema: "" });
  check(!vazio.encontrou, "tema vazio → encontrou:false");
}

// ── 2) montarDoc/gerarDocumento via CC (lib pura, sem rede): cita o artigo do CC, não o do catálogo
{
  const cond = "vancouver"; // tem bloco de cadastro fixo (não precisa Superlógica) + convenção de penalidades
  const ARTIGO_CC =
    "Art. 1.344. Ao proprietário do terraço de cobertura incumbem as despesas da sua conservação, de modo que não haja danos às unidades imobiliárias inferiores.";
  const ocorrencia = {
    condominio: cond, tipo: "notificacao",
    base_legal: "codigo_civil",
    artigo_cc: { fundamento: "Código Civil (Lei nº 10.406/2002), Art. 1.344", texto_artigo: ARTIGO_CC },
    destinatario: { nome: "Fulano de Tal", genero: "M", papel: "proprietario", apartamento: "12" },
    relato: RELATO_INFILTRACAO,
    data_documento: "24 de julho de 2026",
  };
  const w = gerarDocumento({ ocorrencia, formato: "word" });
  const doc = fs.readFileSync(w.destino, "utf8");
  // o fundamento sai em negrito (<b>Código Civil…</b>) — checa as duas partes, tolerante ao split da tag
  check(/Considerando o que dispõe o/.test(doc) && /Código Civil \(Lei/.test(doc), "o fundamento deve citar o Código Civil");
  check(doc.includes("unidades imobiliárias inferiores"), "o texto VERBATIM do artigo do CC deve estar no documento");
  check(/>NOTIFICAÇÃO</.test(doc) && !/COM MULTA/.test(doc) && !doc.includes("será aplicada multa condominial"),
    "documento pelo CC sai como NOTIFICAÇÃO (título sem multa e sem parágrafo de penalidade)");
  try { fs.unlinkSync(w.destino); } catch {}

  // multa + CC → recusa (a lei não fixa valor de multa)
  assert.throws(() => gerarDocumento({ ocorrencia: { ...ocorrencia, tipo: "multa", penalidade: { mes_boleto: "agosto de 2026" } } }),
    /Código Civil|notifica/i, "base_legal=codigo_civil com tipo=multa deveria lançar erro");
  // CC sem artigo_cc → recusa
  assert.throws(() => gerarDocumento({ ocorrencia: { ...ocorrencia, artigo_cc: undefined } }),
    /artigo_cc/i, "base_legal=codigo_civil sem artigo_cc deveria lançar erro");
}

// ── 3) sugerirCodigoCivil: RI já foi barrado → confirma o CC com o MESMO verificador (injetado)
{
  const chatSim = async () => ({ content: '{"cobre":"sim"}' });
  const s = await sugerirCodigoCivil({ relato: RELATO_INFILTRACAO }, { chat: chatSim });
  check(s.encontrou, "verificador diz 'sim' → sugere o artigo do CC");
  check(/Código Civil/i.test(s.fundamento) && /Art\.\s*1\.\d+/.test(s.fundamento), `fundamento do CC malformado: ${s.fundamento}`);
  check(typeof s.texto_artigo === "string" && s.texto_artigo.length > 20, "texto_artigo verbatim");

  const chatNao = async () => ({ content: '{"cobre":"nao"}' });
  const s2 = await sugerirCodigoCivil({ relato: RELATO_INFILTRACAO }, { chat: chatNao });
  check(!s2.encontrou, "verificador diz 'nao' p/ todos os candidatos → não sugere (humano)");

  const s3 = await sugerirCodigoCivil({ relato: RELATO_INFILTRACAO }); // sem chat e sem chave → não confirma
  check(!s3.encontrou, "sem verificador (LLM) → fail-CLOSED: não gera pelo CC");
}

// verificador que reprova o artigo do CATÁLOGO (ruído de obra) e aprova o do CÓDIGO CIVIL
const chatRoteador = async ({ messages }) => {
  const c = String(messages[messages.length - 1]?.content || "");
  if (/Ru[íi]dos provenientes de obras/i.test(c)) return { content: '{"cobre":"nao"}' }; // artigo do catálogo (errado)
  return { content: '{"cobre":"sim"}' }; // artigo do Código Civil (governa)
};
const noSL = async () => ({ encontrado: false }); // pula o Superlógica (hermético) → cai no cadastro do catálogo

// ── 4) roteamento no gerar_documento: RI barrado → OFERECE o Código Civil
{
  const infr = Object.keys(carregarCondominio("allure").catalogo_infracoes);
  check(infr.includes("obra_fora_horario"), "fixture: allure precisa ter a infração de obra (base do incidente)");
  const out = await gerar_documento({
    condominio: "allure", tipo: "notificacao", infracao_id: "obra_fora_horario", // enquadramento ERRADO de propósito
    destinatario: { nome: "Ciclano", genero: "M", apartamento: "21" },
    relato: RELATO_INFILTRACAO, data_documento: "24 de julho de 2026",
  }, { chat: chatRoteador, resolverCondominio: noSL });
  check(out.ok === false && out.motivo === "usar_codigo_civil", `esperava motivo usar_codigo_civil, veio ${JSON.stringify(out.motivo)}`);
  check(/Código Civil/i.test(out.codigo_civil?.fundamento || ""), "a oferta deve trazer o fundamento do CC");
}

// ── 5) roteamento: nem RI nem CC cobrem → sem_base_legal (humano)
{
  const chatTudoNao = async () => ({ content: '{"cobre":"nao"}' });
  const out = await gerar_documento({
    condominio: "allure", tipo: "notificacao", infracao_id: "obra_fora_horario",
    destinatario: { nome: "Ciclano", genero: "M", apartamento: "21" },
    relato: RELATO_INFILTRACAO, data_documento: "24 de julho de 2026",
  }, { chat: chatTudoNao, resolverCondominio: noSL });
  check(out.ok === false && out.motivo === "sem_base_legal", `esperava sem_base_legal, veio ${JSON.stringify(out.motivo)}`);
}

// ── 6) geração explícita via base_legal=codigo_civil → gera a notificação citando a lei
{
  const out = await gerar_documento({
    condominio: "allure", base_legal: "codigo_civil", tipo: "notificacao",
    destinatario: { nome: "Ciclano", genero: "M", apartamento: "21" },
    relato: RELATO_INFILTRACAO, data_documento: "24 de julho de 2026",
  }, { chat: chatRoteador, resolverCondominio: noSL });
  check(out.ok === true, `geração pelo CC deveria dar ok:true, veio ${JSON.stringify(out)}`);
  check(out.base_legal === "codigo_civil", "resultado deve marcar base_legal codigo_civil");
  const doc = fs.readFileSync(path.join(SAIDA, out.arquivo), "utf8");
  check(/Considerando o que dispõe o/.test(doc) && /Código Civil \(Lei/.test(doc), "o documento gerado deve citar o Código Civil");
  check(!/Ru[íi]dos provenientes de obras/i.test(doc), "não pode citar o artigo de obra (enquadramento errado)");
  try { fs.unlinkSync(path.join(SAIDA, out.arquivo)); } catch {}
}

console.log(`test_codigo_civil_documento: ${ok}/${total} OK`);
