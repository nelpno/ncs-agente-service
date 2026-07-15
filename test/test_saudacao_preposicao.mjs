// test_saudacao_preposicao.mjs — determinístico, sem LLM, sem Superlógica.
// A saudação do documento monta "<papel> <preposição> apartamento <n>". A preposição era fixa
// em "do", o que só está certo para proprietário/inquilino/morador: "responsável DO apartamento"
// está errado em português — o certo é "responsável PELO apartamento".
//
// Não é preciosismo de estilo: `responsavel` é o termo NEUTRO e o DEFAULT do motor, e desde o
// 3fba039 (papel deixou de ser obrigatório no schema) ele virou o caminho COMUM — ou seja, o erro
// passou a sair na maioria das advertências/multas, que o síndico assina.
//
// Lê o TEXTO VISÍVEL (sem tags), como o test_papel_opcional: o negrito estrutural envolve
// "apartamento 101" em <b>, e quem lê o documento vê a frase inteira.
import assert from "node:assert";
import fs from "node:fs";
import { gerarDocumento, carregarCondominio, listarInfracoes } from "../gerador/src/gerar-lib.mjs";

let ok = 0, total = 0;
const check = (c, m) => { total++; assert(c, m); ok++; };

const cond = "vancouver";
const infracao_id = listarInfracoes(carregarCondominio(cond))[0].id;
const CADASTRO = { nome: "CONDOMINIO TESTE", endereco: "RUA X, 1", cep: "14800-000", cidade_uf: "ARARAQUARA/SP", cidade_fecho: "Araraquara" };
const base = {
  condominio: cond, tipo: "notificacao", infracao_id,
  relato: "Relato de teste para validar a preposição da saudação.",
  data_documento: "14 de julho de 2026",
};
const semTags = (h) => h.replace(/<[^>]+>/g, "");
const textoDe = (destinatario) => {
  const r = gerarDocumento({ ocorrencia: { ...base, destinatario }, cadastro: CADASTRO, formato: "word" });
  const t = semTags(fs.readFileSync(r.destino, "utf8"));
  try { fs.unlinkSync(r.destino); } catch {}
  return t;
};

// ---- 1) o neutro (default desde 3fba039): "responsável PELO apartamento" -------------------
{
  const t = textoDe({ nome: "Fulano de Tal", apartamento: "101" });
  check(t.includes("responsável pelo apartamento 101"),
    'sem papel, esperado "responsável pelo apartamento 101" no texto visível');
  check(!t.includes("responsável do apartamento"),
    '"responsável do apartamento" está errado em português (é "pelo")');
}

// ---- 2) papel explícito segue com "do" — a regra é por papel, não um replace cego ----------
{
  const t = textoDe({ nome: "Fulana de Tal", apartamento: "202", papel: "proprietario", genero: "F" });
  check(t.includes("proprietária do apartamento 202"),
    '"proprietária DO apartamento" está certo e não pode virar "pelo"');
}
{
  const t = textoDe({ nome: "Beltrano", apartamento: "303", papel: "inquilino" });
  check(t.includes("inquilino do apartamento 303"), '"inquilino do apartamento" deve seguir igual');
}
{
  const t = textoDe({ nome: "Sicrano", apartamento: "404", papel: "morador" });
  check(t.includes("morador do apartamento 404"), '"morador do apartamento" deve seguir igual');
}

// ---- 3) papel desconhecido cai no neutro sem quebrar a frase -------------------------------
{
  // buscar_morador pode devolver papel fora do enum (dependente/imobiliaria/procurador).
  const t = textoDe({ nome: "Ciclano", apartamento: "505", papel: "dependente" });
  check(/(responsável pelo|condômino\(a\) do) apartamento 505/.test(t),
    `papel fora do enum deve cair no neutro com preposição coerente; saiu: ${(t.match(/.{0,40}apartamento 505/) || [""])[0]}`);
}

console.log(`test_saudacao_preposicao: ${ok}/${total} OK`);
