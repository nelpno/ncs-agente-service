// test_secullum.mjs — determinístico, sem LLM, sem rede, sem PII real (fixtures sintéticas).
// Cobre o matching de colaborador, o cruzamento afastamento→nome, o resumo de batidas, os defaults de
// período e a anti-alucinação (CPF fora do cadastro NÃO vira nome inventado). runTool roteia via ctx.secullumDeps.
// Env setado no topo (config lê no import) → _configurado()=true, mas TUDO roda com deps injetadas (0 rede).
process.env.SECULLUM_USER = "svc@teste";
process.env.SECULLUM_PASS = "senha-teste";

const SEK = await import("../src/secullum.mjs");
const { TOOLS, runTool } = await import("../src/agent.mjs");

let falhas = 0;
const ok = (c, m) => { console.log(`${c ? "OK  " : "FALHA"} ${m}`); if (!c) falhas++; };

// ---- fixtures (nada de PII real) ----
const FUNCS = [
  { Id: 1, Nome: "ABEL DE JESUS SILVA", NumeroFolha: "255", Cpf: "12345678901", NumeroPis: "10763047233" },
  { Id: 2, Nome: "MARIA DAS DORES", NumeroFolha: "256", Cpf: "22233344455", NumeroPis: "20000000001" },
  { Id: 3, Nome: "JOÃO PEREIRA LIMA", NumeroFolha: "300", Cpf: "33344455566", NumeroPis: "30000000002" },
  { Id: 4, Nome: "JOÃO PEREIRA COSTA", NumeroFolha: "301", Cpf: "44455566677", NumeroPis: "40000000003" },
];
const AFAST = [
  { Cpf: "12345678901", NumeroPis: "10763047233", Inicio: "2026-07-20T00:00:00", Fim: "2026-08-05T00:00:00", Motivo: "Férias" },
  { Cpf: "99988877766", NumeroPis: "90000000000", Inicio: "2026-07-18T00:00:00", Fim: "2026-07-22T00:00:00", Motivo: "Atestado" }, // fora do cadastro
];
const BATIDAS = [
  { FuncionarioId: 1, Data: "2026-07-21T00:00:00", Entrada1: "2026-07-21T08:00:00", Saida1: "2026-07-21T12:00:00", Entrada2: "2026-07-21T13:00:00", Saida2: "2026-07-21T17:00:00" },
  { FuncionarioId: 1, Data: "2026-07-22T00:00:00", Entrada1: "08:05", Saida1: "17:02" },
  { FuncionarioId: 2, Data: "2026-07-22T00:00:00", Entrada1: "07:00", Saida1: "15:00" },
];

// 0) tool registrada no cardápio (senão o LLM nunca a chama)
ok(TOOLS.some((t) => t.function?.name === "consultar_ponto"), "consultar_ponto registrada em TOOLS");

// 1) gating puro
ok(SEK._disponivel({ secullumUser: "a", secullumPass: "b" }) === true, "_disponivel true com credenciais");
ok(SEK._disponivel({ secullumUser: "", secullumPass: "b" }) === false, "_disponivel false sem usuário");
ok(SEK._disponivel(null) === false, "_disponivel false sem config");
ok(SEK._configurado() === true, "_configurado true (env setado no teste)");

// 2) _acharFuncionario
ok(SEK._acharFuncionario(FUNCS, "abel de jesus silva").status === "ok", "acha por nome exato (normalizado)");
ok(SEK._acharFuncionario(FUNCS, "abel").funcionario?.Id === 1, "acha por primeiro nome (contains)");
ok(SEK._acharFuncionario(FUNCS, "12345678901").funcionario?.Id === 1, "acha por CPF");
ok(SEK._acharFuncionario(FUNCS, "123.456.789-01").funcionario?.Id === 1, "acha por CPF formatado");
const amb = SEK._acharFuncionario(FUNCS, "joão pereira");
ok(amb.status === "ambiguo" && amb.opcoes.length === 2, "João Pereira → ambíguo (2 opções), não escolhe");
ok(SEK._acharFuncionario(FUNCS, "fulano inexistente").status === "nao_encontrado", "não encontrado");

// 3) _indexFuncionarios + _resumoAfastamentos (anti-alucinação de nome)
const idx = SEK._indexFuncionarios(FUNCS);
const todos = SEK._resumoAfastamentos(AFAST, idx);
ok(todos.length === 2, "afastamentos: 2 no período");
ok(todos.find((a) => a.motivo === "Férias")?.nome === "ABEL DE JESUS SILVA", "afastamento cruza o nome pelo CPF");
ok(todos[0].inicio <= todos[1].inicio, "afastamentos ordenados por data de início");
ok(/colaborador \*\*\*/.test(todos.find((a) => a.motivo === "Atestado").nome), "CPF fora do cadastro → nome MASCARADO (não inventa)");
const soAbel = SEK._resumoAfastamentos(AFAST, idx, { cpf: "12345678901" });
ok(soAbel.length === 1 && soAbel[0].nome === "ABEL DE JESUS SILVA", "filtra afastamento por CPF");

// 4) _resumoBatidas
const dias = SEK._resumoBatidas(BATIDAS, 1);
ok(dias.length === 2, "batidas do funcionário 1: 2 dias (não pega o funcionário 2)");
ok(dias[0].entrada === "08:00" && dias[0].saida === "17:00", "1ª entrada / última saída (formato ISO)");
ok(dias[1].entrada === "08:05" && dias[1].saida === "17:02", "extrai HH:MM de formato curto");

// 5) _normData / _periodo
ok(SEK._normData("22/07/2026") === "2026-07-22", "_normData converte BR → ISO");
ok(SEK._normData("2026-07-22") === "2026-07-22", "_normData mantém ISO");
const p = SEK._periodo({ data_inicio: "01/07/2026", data_fim: "31/07/2026" }, "afastamentos");
ok(p.inicio === "2026-07-01" && p.fim === "2026-07-31", "_periodo respeita datas (normaliza BR→ISO)");
const pd = SEK._periodo({}, "ponto", Date.UTC(2026, 6, 22));
ok(pd.fim === "2026-07-22" && pd.inicio === "2026-06-22", "_periodo default ponto = últimos 30 dias");

// 6) consultar_ponto (deps injetadas, 0 rede)
const dep = { funcionarios: FUNCS, afastamentos: AFAST, batidas: BATIDAS, now: Date.UTC(2026, 6, 22) };
const rAf = await SEK.consultar_ponto({ assunto: "afastamentos" }, dep);
ok(rAf.disponivel && rAf.encontrado && rAf.total === 2, "consultar_ponto afastamentos: 2 itens");
const rAfF = await SEK.consultar_ponto({ assunto: "afastamentos", funcionario: "abel" }, dep);
ok(rAfF.total === 1 && rAfF.itens[0].nome === "ABEL DE JESUS SILVA", "afastamentos filtrados por funcionário");
const rP = await SEK.consultar_ponto({ assunto: "ponto", funcionario: "abel" }, dep);
ok(rP.encontrado && rP.dias_com_marcacao === 2 && rP.dias_no_periodo === 2 && rP.dias_sem_marcacao === 0, "ponto: 2 dias com marcação (separa com/sem)");
const rAmb = await SEK.consultar_ponto({ assunto: "ponto", funcionario: "joão pereira" }, dep);
ok(rAmb.encontrado === false && rAmb.motivo === "ambiguo", "ambíguo → pede confirmação, não escolhe");
const rNE = await SEK.consultar_ponto({ assunto: "ponto", funcionario: "zzz" }, dep);
ok(rNE.encontrado === false && rNE.motivo === "nao_encontrado", "funcionário inexistente → nao_encontrado");
const rFn = await SEK.consultar_ponto({ assunto: "funcionario", funcionario: "abel" }, dep);
ok(rFn.encontrado && rFn.funcionario.nome === "ABEL DE JESUS SILVA" && /\*\*\*/.test(rFn.funcionario.cpf), "funcionario: nome + CPF MASCARADO (não vaza CPF cru)");

// 7) runTool roteia (seam ctx.secullumDeps — em prod é undefined → vai à API real)
const viaRun = await runTool("consultar_ponto", { assunto: "afastamentos" }, { secullumDeps: dep });
ok(viaRun.disponivel && viaRun.total === 2, "runTool roteia consultar_ponto (com deps de teste)");

console.log(`\n${falhas === 0 ? "TODOS OS TESTES VERDES" : falhas + " FALHA(S)"}`);
process.exit(falhas === 0 ? 0 : 1);
