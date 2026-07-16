// test_cadastro_inquilino.mjs — validações + payload (puros, sem rede)
import { cadastroInquilino } from '../src/write/actions/cadastro_inquilino.mjs';
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

// validar: campos obrigatórios
ok(cadastroInquilino.validar({}).ok === false, 'vazio é inválido');
const base = { id_condominio: '179', id_unidade: '900', nome: 'João Silva', papel: 'inquilino', data_entrada: '06/30/2026', cpf: '12345678901' };
ok(cadastroInquilino.validar(base).ok === true, 'campos obrigatórios → válido');

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

// montarPayload: LABEL e obrigatórios
const p = cadastroInquilino.montarPayload(base);
ok(p['contatos[0][ST_NOME_CON]'] === 'João Silva', 'nome mapeado');
ok(p['contatos[0][ID_LABEL_TRES]'] === '7', 'inquilino → LABEL 7');
ok(cadastroInquilino.montarPayload({ ...base, papel: 'dependente' })['contatos[0][ID_LABEL_TRES]'] === '4', 'dependente → LABEL 4');
ok(p['contatos[0][DT_ENTRADA_RES]'] === '06/30/2026', 'data MM/DD/AAAA preservada');
ok(!('contatos[0][ST_EMAIL_CON]' in p), 'opcional ausente não vai no payload');
ok('contatos[0][ST_EMAIL_CON]' in cadastroInquilino.montarPayload({ ...base, email: 'a@b.com' }), 'opcional presente entra');

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
