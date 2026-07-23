// test_dados_condominio.mjs — determinístico, sem rede (condos injetados via deps).
// Video "achar nome do sindico, endereco e CNPJ" (23/07): o Estagiario nao devolvia o CNPJ (nunca era
// buscado) embora ele venha no MESMO condominios/get que o resolver_condominio ja baixa. Campo = st_cnpj_cond
// (confirmado no dump superlogica_map_results.json). Sindico (sindicos/index) fica pro token vivo.
import assert from "node:assert";
const { resolver_condominio } = await import("../src/superlogica.mjs");

let ok = 0, total = 0;
const check = (c, m) => { total++; assert(c, m); ok++; };

const base = {
  id_condominio_cond: 179, st_nome_cond: "CONDOMINIO LUME", st_fantasia_cond: "Lume",
  st_endereco_cond: "RUA X", st_numeroendereco_cond: "100", st_bairro_cond: "CENTRO",
  st_cep_cond: "14800-000", st_cidade_cond: "Araraquara", st_uf_uf: "SP", st_cnpj_cond: "12345678000190",
};

// 1) CNPJ de 14 digitos vem FORMATADO (nao inventa: so formata o que o ERP entregou)
{
  const r = await resolver_condominio({ nome: "Lume" }, { condos: [base] });
  check(r.encontrado, "achou o condominio");
  check(r.cnpj === "12.345.678/0001-90", `CNPJ formatado, veio "${r.cnpj}"`);
  check(r.endereco.includes("RUA X, 100"), "endereco segue vindo ao vivo");
}

// 2) Sem CNPJ no cadastro -> string vazia, nunca inventa
{
  const r = await resolver_condominio({ nome: "Lume" }, { condos: [{ ...base, st_cnpj_cond: "" }] });
  check(r.cnpj === "", "sem CNPJ -> vazio (nao inventa)");
}

// 3) Valor fora do padrao (nao sao 14 digitos) -> vazio, nao devolve lixo (so entrega o que tem cara de CNPJ)
{
  const r = await resolver_condominio({ nome: "Lume" }, { condos: [{ ...base, st_cnpj_cond: "123" }] });
  check(r.cnpj === "", `CNPJ nao-padrao (nao 14 dig) -> vazio, veio "${r.cnpj}"`);
}

// 4) Fallback st_cgc_con quando st_cnpj_cond ausente (campo alternativo visto no dump)
{
  const { st_cnpj_cond, ...semCnpj } = base;
  const r = await resolver_condominio({ nome: "Lume" }, { condos: [{ ...semCnpj, st_cgc_con: "98765432000155" }] });
  check(r.cnpj === "98.765.432/0001-55", `fallback st_cgc_con, veio "${r.cnpj}"`);
}

// 5) CASO REAL (Lume ao vivo, 23/07): o CNPJ vem em st_cpf_cond; st_cnpj_cond vem VAZIO
{
  const r = await resolver_condominio({ nome: "Lume" }, { condos: [{ ...base, st_cnpj_cond: "", st_cpf_cond: "56300773000148" }] });
  check(r.cnpj === "56.300.773/0001-48", `CNPJ de st_cpf_cond (campo real), veio "${r.cnpj}"`);
}

// 6) st_cpf_cond com 11 dígitos (CPF de condo PF) NÃO é rotulado como CNPJ
{
  const r = await resolver_condominio({ nome: "Lume" }, { condos: [{ ...base, st_cnpj_cond: "", st_cpf_cond: "12345678901" }] });
  check(r.cnpj === "", "CPF de 11 dígitos não vira CNPJ (só 14 dígitos)");
}

console.log(`test_dados_condominio: ${ok}/${total} OK`);
