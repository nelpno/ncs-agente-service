// test_garantidora_taxa_extra.mjs — determinístico, sem LLM, sem rede.
// Buraco medido no uso REAL: no FLORES (182) a Ana manda tudo para a garantidora CONDINVEST, mas a
// TAXA EXTRA daquele condomínio é emitida à parte e a NCS consegue pegar — em 06/08 (conv 685) ela
// direcionou à Condinvest e o atendente, em seguida, entregou o boleto da taxa extra do apto 624.
// A moradora ouviu "não é conosco" sobre uma coisa que É conosco.
//
// A correção é de DADO (nota no condomínio), não de mecanismo: quem não tem a nota continua
// respondendo exatamente como antes — é isso que este teste trava dos dois lados.
import assert from "node:assert";
import { consultar_garantidora, _matchGarantidora } from "../src/garantidora.mjs";

let ok = 0, total = 0;
const check = (c, m) => { total++; assert(c, m); ok++; };

// ---------- 1) Flores: continua direcionando à garantidora E avisa da taxa extra ----------
{
  const r = consultar_garantidora({ id_condominio: 182 });
  check(r.tem === true, "Flores segue sendo condomínio de garantidora");
  check(r.tipo === "total", `tipo total preservado, veio ${r.tipo}`);
  check(r.garantidora?.nome === "CONDINVEST", "garantidora preservada");
  check(typeof r.nota_extra === "string" && r.nota_extra.length > 0, "Flores traz nota_extra");
  check(/taxa extra/i.test(r.nota_extra), "a nota fala de taxa extra");
  // A nota NÃO pode fechar a porta nem prometer o boleto: a Ana não enxerga esse título,
  // quem consegue é a equipe. Ela oferece verificar — não afirma que vai enviar.
  check(!/n[ãa]o (é|e) conosco|nada a ver/i.test(r.nota_extra), "a nota NÃO diz que não é conosco");
  check(/equipe|verific|confir/i.test(r.nota_extra), "a nota oferece verificação com a equipe");
  check(!/em dia|quitad|sem d[ée]bito/i.test(r.nota_extra), "a nota NUNCA afirma quitação");
}

// ---------- 2) O outro lado: condomínio de garantidora SEM taxa extra não ganha a nota ----------
// (Se a nota vazasse para todos, a Ana ofereceria conferir uma taxa que não existe naquele prédio.)
{
  const r = consultar_garantidora({ id_condominio: 188 }); // VITTA IPÊ ROXO — mesma garantidora
  check(r.tem === true && r.tipo === "total", "Ipê Roxo segue garantidora total");
  check(r.nota_extra === undefined, "condomínio sem taxa extra NÃO recebe a nota");
}

// ---------- 3) Condomínio que não é de garantidora segue intocado ----------
{
  const r = consultar_garantidora({ id_condominio: 179 }); // Lume
  check(r.tem === false, "Lume não é de garantidora");
  check(r.nota_extra === undefined, "e não ganha nota nenhuma");
}

// ---------- 4) O dado está no lugar certo (é do condomínio, não da garantidora) ----------
// A CONDINVEST atende vários prédios; pendurar a nota nela levaria o aviso do Flores
// para o Ipê Roxo e o Vistas do Botânico.
{
  const c = _matchGarantidora({ id_condominio: 182 });
  check(typeof c.nota_extra === "string", "a nota mora no registro do CONDOMÍNIO");
}

console.log(`test_garantidora_taxa_extra: ${ok}/${total} OK`);
