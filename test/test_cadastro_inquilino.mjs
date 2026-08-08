// test_cadastro_inquilino.mjs — validações + payload (puros, sem rede)
import { cadastroInquilino } from '../src/write/actions/cadastro_inquilino.mjs';
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

// validar: campos obrigatórios
ok(cadastroInquilino.validar({}).ok === false, 'vazio é inválido');
// e-mail + telefone entram no `base` porque agora são OBRIGATÓRIOS p/ inquilino (Fernando 22/07).
// ⚠️ o CPF da fixture tem de ser VÁLIDO (dígito fecha) desde 07/08/2026: `validar` passou a conferir
// o dígito verificador, e uma fixture com número inventado testaria um cadastro que não existe.
// 529.982.247-25 é o CPF canônico de teste.
const base = { id_condominio: '179', id_unidade: '900', nome: 'João Silva', papel: 'inquilino', data_entrada: '06/30/2026', cpf: '52998224725', email: 'joao@x.com', telefone: '16999998888' };
ok(cadastroInquilino.validar(base).ok === true, 'campos obrigatórios → válido');

// ── e-mail e telefone OBRIGATÓRIOS p/ inquilino (Fernando REVERTEU em 22/07 a graduação de 14/07) ──
const semEmail = { ...base }; delete semEmail.email;
ok(cadastroInquilino.validar(semEmail).ok === false, 'inquilino SEM e-mail → inválido (obrigatório desde 22/07)');
ok(/e-mail/i.test(cadastroInquilino.validar(semEmail).erros.join(' ')), 'o erro diz que faltou o e-mail');
const semTel = { ...base }; delete semTel.telefone;
ok(cadastroInquilino.validar(semTel).ok === false, 'inquilino SEM telefone → inválido');
// Dependente segue LENIENTE: nem CPF, nem e-mail, nem telefone travam (Fernando: "menor não é obrigatório")
const depSoBasico = { id_condominio: '179', id_unidade: '900', nome: 'Filho Menor', papel: 'dependente', data_entrada: '06/30/2026' };
ok(cadastroInquilino.validar(depSoBasico).ok === true, 'dependente sem CPF/e-mail/telefone → válido (leniente)');

// ── CPF do inquilino (Fernando, 15/07) ────────────────────────────────────────────────────────────
// "o CPF, para gerar o boleto da taxa de condomínio... sem o CPF a gente não consegue gerar."
// Um cadastro de inquilino sem CPF ENTRA e não serve para nada — a equipe não emite o boleto. Então
// trava aqui: a Ana pede o CPF em vez de mandar para a fila um rascunho natimorto.
const semCpf = { ...base }; delete semCpf.cpf;
ok(cadastroInquilino.validar(semCpf).ok === false, 'inquilino SEM CPF → inválido (sem CPF não se gera o boleto)');
ok(/cpf/i.test(cadastroInquilino.validar(semCpf).erros.join(' ')), 'o erro diz que faltou o CPF');
// papel ausente = inquilino (default do agent.mjs) → mesma exigência
ok(cadastroInquilino.validar({ ...semCpf, papel: undefined }).ok === false, 'papel ausente (=inquilino) sem CPF → inválido');
// Dependente NÃO recebe cobrança (141/141 no dado real) → boleto não existe → CPF não trava.
ok(cadastroInquilino.validar({ ...semCpf, papel: 'dependente' }).ok === true, 'dependente sem CPF → válido (não recebe boleto)');
ok(cadastroInquilino.validar({ ...base, data_entrada: '30/06/2026' }).ok === false, 'data fora de MM/DD/AAAA → inválido');
ok(cadastroInquilino.validar({ ...base, papel: 'sindico' }).ok === false, 'papel inválido rejeitado');

// ── FORMATO do e-mail (defeito 6 do teste dos 20; o Fernando pediu o teste ao vivo, 00:44:17) ──────
// Ela aceitou `eduardo.simoes@com.br`. O CPF tem validação e o e-mail não tinha nenhuma — e os dois
// têm a MESMA consequência: é para onde o boleto vai. E-mail errado não volta como erro; o morador
// simplesmente não recebe cobrança "e ninguém descobre até virar inadimplência" (Fernando, 00:43:11).
const erroDe = (d) => cadastroInquilino.validar(d).erros.join(' ');
ok(cadastroInquilino.validar({ ...base, email: 'eduardo.simoes@com.br' }).ok === false, 'e-mail no domínio nu "@com.br" → inválido (ninguém tem e-mail nesse domínio)');
ok(/e-?mail/i.test(erroDe({ ...base, email: 'eduardo.simoes@com.br' })), 'o erro diz que o problema é o e-mail');
ok(cadastroInquilino.validar({ ...base, email: 'joao@gmail' }).ok === false, 'sem o final do domínio (.com) → inválido');
ok(cadastroInquilino.validar({ ...base, email: 'joao@.com' }).ok === false, 'domínio começando com ponto → inválido');
ok(cadastroInquilino.validar({ ...base, email: 'joaogmail.com' }).ok === false, 'sem @ → inválido (o teste que o Fernando pediu ao vivo)');
ok(cadastroInquilino.validar({ ...base, email: 'joao @x.com' }).ok === false, 'com espaço no meio → inválido');
ok(cadastroInquilino.validar({ ...base, email: '@x.com' }).ok === false, 'sem nada antes do @ → inválido');
ok(cadastroInquilino.validar({ ...base, email: 'joao@x' }).ok === false, 'domínio sem ponto → inválido');
// CONTROLE — e-mail que existe de verdade não pode ser barrado. Falso positivo aqui trava um
// cadastro correto no atendimento, que é pior do que o defeito que estamos consertando.
for (const bom of ['joao@x.com', 'joao.silva@gmail.com', 'joao+tag@empresa.com.br', 'jo-ao_1@sub.dominio.org', 'JOAO@X.COM', 'maria@escritorio.adv.br']) {
  ok(cadastroInquilino.validar({ ...base, email: bom }).ok === true, `CONTROLE: "${bom}" continua válido`);
}
ok(cadastroInquilino.validar({ ...base, email: ' joao@x.com ' }).ok === true, 'espaço em volta não invalida (é aparado)');
// Dependente segue leniente: e-mail AUSENTE não trava. Mas e-mail ERRADO trava em qualquer papel —
// não faz sentido guardar no cadastro um endereço que sabidamente não existe.
ok(cadastroInquilino.validar(depSoBasico).ok === true, 'dependente SEM e-mail → válido (leniência preservada)');
ok(cadastroInquilino.validar({ ...depSoBasico, email: 'x@com.br' }).ok === false, 'dependente COM e-mail errado → inválido');

// ── DÍGITO do CPF (defeito 9) ─────────────────────────────────────────────────────────────────────
// No caso 3 a Ana recusou o CPF duas vezes, mas por outro motivo: ele não existia no ERP. Ela nunca
// disse que o número era inválido, então a pessoa não sabia o que corrigir. Agora o dígito é
// conferido aqui e o erro diz o que houve.
ok(cadastroInquilino.validar({ ...base, cpf: '12345678901' }).ok === false, 'CPF com dígito que não fecha → inválido');
ok(/d[ií]gito|inv[áa]lido/i.test(erroDe({ ...base, cpf: '12345678901' })), 'o erro explica que o CPF é inválido, não que "faltou"');
ok(cadastroInquilino.validar({ ...base, cpf: '11111111111' }).ok === false, 'CPF de dígitos repetidos → inválido');
ok(cadastroInquilino.validar({ ...base, cpf: '5299822472' }).ok === false, 'CPF com 10 dígitos → inválido');
// CONTROLE: CPF válido passa, com e sem máscara.
ok(cadastroInquilino.validar({ ...base, cpf: '529.982.247-25' }).ok === true, 'CONTROLE: CPF válido com máscara passa');
ok(cadastroInquilino.validar({ ...base, cpf: '52998224725' }).ok === true, 'CONTROLE: CPF válido sem máscara passa');
ok(cadastroInquilino.validar({ ...depSoBasico, cpf: '52998224725' }).ok === true, 'dependente com CPF válido → válido');
ok(cadastroInquilino.validar({ ...depSoBasico, cpf: '12345678901' }).ok === false, 'dependente com CPF inválido → inválido (dado errado é errado em qualquer papel)');

// montarPayload: LABEL e obrigatórios
const p = cadastroInquilino.montarPayload(base);
ok(p['contatos[0][ST_NOME_CON]'] === 'João Silva', 'nome mapeado');
ok(p['contatos[0][ID_LABEL_TRES]'] === '7', 'inquilino → LABEL 7');
ok(cadastroInquilino.montarPayload({ ...base, papel: 'dependente' })['contatos[0][ID_LABEL_TRES]'] === '4', 'dependente → LABEL 4');
ok(p['contatos[0][DT_ENTRADA_RES]'] === '06/30/2026', 'data MM/DD/AAAA preservada');
ok(!('contatos[0][ST_RG_CON]' in p), 'opcional ausente (RG) não vai no payload');
ok('contatos[0][ST_EMAIL_CON]' in cadastroInquilino.montarPayload({ ...base, email: 'a@b.com' }), 'opcional presente entra');
ok(cadastroInquilino.montarPayload({ ...base, rg: '12.345.678-9' })['contatos[0][ST_RG_CON]'] === '12.345.678-9', 'RG presente entra no payload');

// ── Extras por condomínio (Tivoli 164): nascimento + veículo + placa ────────────────────────────────
const baseTivoli = { ...base, id_condominio: '164' };
ok(cadastroInquilino.validar(baseTivoli).ok === false, 'Tivoli sem os extras → inválido (exige nascimento/veículo/placa)');
const tivoliCompleto = { ...baseTivoli, data_nascimento: '01/02/2000', veiculo_modelo: 'Gol', veiculo_placa: 'ABC1D23' };
ok(cadastroInquilino.validar(tivoliCompleto).ok === true, 'Tivoli com os 3 extras → válido');
const pTiv = cadastroInquilino.montarPayload(tivoliCompleto);
ok(pTiv['contatos[0][DT_NASCIMENTO_CON]'] === '01/02/2000', 'Tivoli: nascimento vai ao ERP (DT_NASCIMENTO_CON)');
ok(!Object.keys(pTiv).some((k) => /PLACA|VEICULO/i.test(k)), 'veículo/placa NÃO vão ao ERP (ficam no card)');
// Dependente no Tivoli NÃO é travado pelos extras (leniência do menor prevalece sobre "qualquer tipo adulto")
ok(cadastroInquilino.validar({ ...depSoBasico, id_condominio: '164' }).ok === true, 'dependente no Tivoli → válido (extras só p/ adulto)');

// IO injetável
// ⚠️ o campo é `st_cpf_con` — é o que `responsaveis/index` devolve DE VERDADE. Esta fixture dizia
// `st_cpfcnpj_con` (nome usado só na ESCRITA), campo que a leitura nunca traz: o teste ficava verde
// enquanto, em produção, a comparação por CPF era sempre falsa e a duplicata passava. Fixture com
// campo inventado não testa nada. Detalhe e casos em test_conflito_duplicata.mjs.
const ioFake = {
  responsaveisIndex: async () => ([{ id_unidade_uni: '900', st_cpf_con: '11122233344', st_nome_con: 'João Silva' }]),
  slPut: async () => ({ ok: true, dryRun: true, echo: {} }),
};
const conf = await cadastroInquilino.checarConflito({}, { ...base, cpf: '11122233344' }, ioFake);
ok(conf.conflito === true, 'CPF já presente na unidade → conflito');
// "Novo" = pessoa nova: CPF novo E nome novo. Só trocar o CPF mantendo o nome "João Silva" é a MESMA
// pessoa com CPF novo/corrigido — e isso É conflito (o caso real do Bruno Muller, 16/07).
const semConf = await cadastroInquilino.checarConflito({}, { ...base, nome: 'Joana Pereira Lima', cpf: '99999999999' }, ioFake);
ok(semConf.conflito === false, 'pessoa nova (nome e CPF novos) → sem conflito');
const mesmoNomeOutroCpf = await cadastroInquilino.checarConflito({}, { ...base, cpf: '99999999999' }, ioFake);
ok(mesmoNomeOutroCpf.conflito === true, 'mesmo nome com CPF diferente → conflito (não duplica a pessoa)');
const snap = await cadastroInquilino.snapshot({}, base, ioFake);
ok(Array.isArray(snap) && snap.length === 1, 'snapshot lista contatos da unidade');
const g = await cadastroInquilino.gravar(cadastroInquilino.montarPayload(base), { dados: base, io: ioFake });
ok(g.ok === true, 'gravar usa slPut injetado (DRY_RUN)');
const rnd = cadastroInquilino.render(base, snap);
ok(Array.isArray(rnd.campos) && rnd.campos.length > 0, 'render retorna campos p/ o painel');

// posGravar (Onda 1): enfileira o aviso via outbox.mjs real (sem SUPABASE_URL no ambiente de teste →
// cai no fallback in-memory; condomínio real "Lume" existe em data/portaria/sistemas-portaria.json).
const dadosAviso = { ...base, condominio_nome: 'Lume', unidade_label: 'Apto 42' };
const pos = await cadastroInquilino.posGravar(dadosAviso, { dryRun: true });
ok(pos?.aviso?.ok === true, 'posGravar → enfileira aviso quando o condomínio resolve');
ok(typeof pos.aviso.enfileirados === 'number' && pos.aviso.enfileirados > 0, 'posGravar → enfileirados > 0');

// Async + nunca lança: condomínio não informado/não resolvido → aviso.ok:false, sem exceção
const posSemCondo = await cadastroInquilino.posGravar({ ...base, condominio_nome: 'Condomínio Inexistente XPTO' }, { dryRun: true });
ok(posSemCondo?.aviso?.ok === false && posSemCondo.aviso.enfileirados === 0, 'posGravar → sem condomínio resolvido, não lança, reporta 0');

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
