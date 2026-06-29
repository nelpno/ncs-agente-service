// test_cadastro_inquilino.mjs — validações + payload (puros, sem rede)
import { cadastroInquilino } from '../src/write/actions/cadastro_inquilino.mjs';
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

// validar: campos obrigatórios
ok(cadastroInquilino.validar({}).ok === false, 'vazio é inválido');
const base = { id_condominio: '179', id_unidade: '900', nome: 'João Silva', papel: 'inquilino', data_entrada: '06/30/2026' };
ok(cadastroInquilino.validar(base).ok === true, 'campos obrigatórios → válido');
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
const ioFake = {
  responsaveisIndex: async () => ([{ id_unidade_uni: '900', st_cpfcnpj_con: '11122233344', st_nome_con: 'João Silva' }]),
  slPut: async () => ({ ok: true, dryRun: true, echo: {} }),
};
const conf = await cadastroInquilino.checarConflito({}, { ...base, cpf: '11122233344' }, ioFake);
ok(conf.conflito === true, 'CPF já presente na unidade → conflito');
const semConf = await cadastroInquilino.checarConflito({}, { ...base, cpf: '99999999999' }, ioFake);
ok(semConf.conflito === false, 'CPF novo → sem conflito');
const snap = await cadastroInquilino.snapshot({}, base, ioFake);
ok(Array.isArray(snap) && snap.length === 1, 'snapshot lista contatos da unidade');
const g = await cadastroInquilino.gravar(cadastroInquilino.montarPayload(base), { dados: base, io: ioFake });
ok(g.ok === true, 'gravar usa slPut injetado (DRY_RUN)');
const rnd = cadastroInquilino.render(base, snap);
ok(Array.isArray(rnd.campos) && rnd.campos.length > 0, 'render retorna campos p/ o painel');

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
