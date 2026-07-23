// test_titularidade.mjs — WriteAction #2 (Onda C, DRY). Troca de titularidade: cadastra o novo
// proprietário + dá saída (DT_SAIDA_RES) no antigo. io injetável (slPut/responsaveisIndex) — sem rede/PII.
import assert from 'node:assert';
import { titularidade as T, extrairProprietariosAtuais } from '../src/write/actions/titularidade.mjs';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

const baseOK = {
  id_condominio: '152', id_unidade: '11826', nome: 'Ana Compradora',
  data_transferencia: '03/09/2026', cpf: '12345678900', email: 'ana@x.com', telefone: '16999997777',
  proprietarios_atuais: [{ id_contato_con: '51050', nome: 'Gustavo Antigo', cpf: '98765432100' }],
};

// ---------------------------------------------------- 1) validar
{
  ok(T.validar(baseOK).ok === true, 'happy path valida');
  ok(T.validar({ ...baseOK, cpf: '' }).ok === false, 'sem cpf do novo -> invalido');
  ok(T.validar({ ...baseOK, email: '' }).ok === false, 'sem e-mail do novo -> invalido (obrigatorio desde 22/07)');
  ok(T.validar({ ...baseOK, telefone: '' }).ok === false, 'sem telefone do novo -> invalido');
  ok(T.validar({ ...baseOK, data_transferencia: '31/13/2026' }).ok === false, 'data fora de MM/DD/AAAA -> invalido');
  ok(T.validar({ ...baseOK, proprietarios_atuais: [] }).ok === false, 'sem proprietario atual -> invalido (nao seria troca)');
  ok(T.validar({ ...baseOK, proprietarios_atuais: [{ nome: 'X' }] }).ok === false, 'proprietario atual sem id_contato_con -> invalido');
  ok(T.validar({ ...baseOK, id_unidade: '' }).ok === false, 'sem id_unidade -> invalido');
  // extras por condominio (Tivoli 164): exige nascimento+veiculo+placa tambem na titularidade
  ok(T.validar({ ...baseOK, id_condominio: '164' }).ok === false, 'Tivoli sem extras -> invalido');
  const tiv = T.montarPayload({ ...baseOK, id_condominio: '164', data_nascimento: '01/02/1990', veiculo_modelo: 'Onix', veiculo_placa: 'XYZ9K88', rg: '11.222.333-4' });
  ok(T.validar({ ...baseOK, id_condominio: '164', data_nascimento: '01/02/1990', veiculo_modelo: 'Onix', veiculo_placa: 'XYZ9K88' }).ok === true, 'Tivoli com extras -> valido');
  ok(tiv.novo['contatos[0][DT_NASCIMENTO_CON]'] === '01/02/1990', 'Tivoli: nascimento no payload do novo');
  ok(tiv.novo['contatos[0][ST_RG_CON]'] === '11.222.333-4', 'RG opcional entra no payload do novo');
  ok(!Object.keys(tiv.novo).some((k) => /PLACA|VEICULO/i.test(k)), 'veiculo/placa NAO vao ao ERP');
}

// ---------------------------------------------------- 2) montarPayload: 1 novo + 1 saida por proprietario
{
  const p = T.montarPayload(baseOK);
  ok(p.novo['contatos[0][ST_NOME_CON]'] === 'Ana Compradora', 'novo: nome');
  ok(p.novo['contatos[0][ID_LABEL_TRES]'] === '1', 'novo: label proprietario (1)');
  ok(p.novo['contatos[0][ID_TIPORESP_TRES]'] === '1', 'novo: recebe cobranca normal+extra (1)');
  ok(p.novo['contatos[0][DT_ENTRADA_RES]'] === '03/09/2026', 'novo: data de entrada = transferencia');
  ok(p.novo['contatos[0][ST_CPFCNPJ_CON]'] === '12345678900', 'novo: cpf no campo de ESCRITA (ST_CPFCNPJ_CON)');
  ok(Array.isArray(p.saidas) && p.saidas.length === 1, '1 saida (1 proprietario atual)');
  ok(p.saidas[0]['contatos[0][ID_CONTATO_CON]'] === '51050', 'saida: ID_CONTATO_CON do antigo');
  ok(p.saidas[0]['contatos[0][DT_SAIDA_RES]'] === '03/09/2026', 'saida: DT_SAIDA_RES = transferencia (inativacao)');
  // 2 proprietarios atuais -> 2 saidas
  const p2 = T.montarPayload({ ...baseOK, proprietarios_atuais: [{ id_contato_con: '1', nome: 'A' }, { id_contato_con: '2', nome: 'B' }] });
  ok(p2.saidas.length === 2, '2 proprietarios atuais -> 2 saidas');
}

// ---------------------------------------------------- 3) gravar (DRY): 1 novo + N saidas; agrega resultado
{
  const calls = [];
  const io = { slPut: async (path, fields) => { calls.push({ path, fields }); return { ok: true, dryRun: true, echo: fields }; } };
  const r = await T.gravar(T.montarPayload(baseOK), { dados: baseOK, io });
  ok(r.ok === true && r.dryRun === true, 'gravar DRY: ok + dryRun');
  ok(calls.length === 2, '2 chamadas (1 novo + 1 saida)');
  ok(calls[0].path === 'unidades/post' && calls[1].path === 'unidades/post', 'ambas em unidades/post');
  ok(r.resposta.saidas.length === 1 && r.saidasFalhas === 0, 'saidas registradas, 0 falhas');
}

// novo falha -> aborta (nao dá saida em ninguem)
{
  const calls = [];
  const io = { slPut: async (path, fields) => { calls.push(path); return { ok: false, status: 400, resposta: 'erro' }; } };
  const r = await T.gravar(T.montarPayload(baseOK), { dados: baseOK, io });
  ok(r.ok === false && r.etapa === 'novo_proprietario', 'novo falha -> ok:false, etapa marcada');
  ok(calls.length === 1, 'nao tentou nenhuma saida (abortou no novo)');
}

// novo ok, uma saida falha -> ok:true mas saidasFalhas>0 (sem transacao, estado parcial reportado)
{
  let i = 0;
  const io = { slPut: async () => { i++; return i === 1 ? { ok: true, dryRun: false } : { ok: false, status: 500 }; } };
  const r = await T.gravar(T.montarPayload(baseOK), { dados: baseOK, io });
  ok(r.ok === true && r.saidasFalhas === 1, 'saida falha nao desfaz o novo, mas e reportada (saidasFalhas=1)');
}

// ---------------------------------------------------- 4) checarConflito: novo proprietario ja consta
{
  const io = { responsaveisIndex: async () => [{ st_nome_con: 'Ana Compradora', st_cpf_con: '' }] };
  const c = await T.checarConflito({}, baseOK, io);
  ok(c.conflito === true, 'novo ja consta (mesmo nome) -> conflito');
  const io2 = { responsaveisIndex: async () => [{ st_nome_con: 'Outra Pessoa', st_cpf_con: '00000000000' }] };
  ok((await T.checarConflito({}, baseOK, io2)).conflito === false, 'ninguem igual -> sem conflito');
}

// ---------------------------------------------------- 5) render: card mostra o match do proprietario atual + alertas
{
  const r = T.render({ ...baseOK, unidade_label: 'APTO 111', condominio_nome: 'TRIADE' }, [{}, {}]);
  const campoAtual = r.campos.find((c) => /atual/i.test(c.label));
  ok(campoAtual && /Gustavo Antigo/.test(campoAtual.valor), 'card mostra o proprietario atual que sai (match do ERP)');
  ok(/…00/.test(campoAtual.valor), 'CPF do atual mascarado (so 2 ultimos) no card');
  ok(r.diff.some((x) => x.tipo === 'add') && r.diff.some((x) => x.tipo === 'del'), 'diff: add novo + del saida');
  ok(r.alertas.some((a) => /DATA DE SAÍDA|inativos/i.test(a)), 'alerta: confirmar quem sai (peso juridico)');
  // 2 proprietarios -> alerta extra
  const r2 = T.render({ ...baseOK, proprietarios_atuais: [{ id_contato_con: '1', nome: 'A' }, { id_contato_con: '2', nome: 'B' }] }, []);
  ok(r2.alertas.some((a) => /TODOS recebem data de saída/i.test(a)), '2 proprietarios -> alerta de "todos saem"');
}

// ---------------------------------------------------- 6) extrairProprietariosAtuais (a tool preenche do ERP)
{
  const contatos = [
    { id_contato_con: '1', st_nome_con: 'Dono Ativo', id_label_tres: '1', dt_saida_res: '', st_cpf_con: '111' },
    { id_contato_con: '2', st_nome_con: 'Co-dono', id_label_tres: '2', dt_saida_res: null, st_cpf_con: '222' },
    { id_contato_con: '3', st_nome_con: 'Inquilino', id_label_tres: '7', dt_saida_res: '', st_cpf_con: '333' },
    { id_contato_con: '4', st_nome_con: 'Ex-dono', id_label_tres: '1', dt_saida_res: '01/01/2020 00:00:00', st_cpf_con: '444' },
  ];
  const p = extrairProprietariosAtuais(contatos);
  ok(p.length === 2, 'só proprietarios ATIVOS (label 1/2, sem dt_saida) — exclui inquilino e ex-dono');
  ok(p.some((x) => x.id_contato_con === '1') && p.some((x) => x.id_contato_con === '2'), 'pega os 2 donos ativos');
  ok(!p.some((x) => x.id_contato_con === '3'), 'exclui inquilino (label 7)');
  ok(!p.some((x) => x.id_contato_con === '4'), 'exclui ex-dono (já tem dt_saida_res)');
  ok(p.every((x) => x.id_contato_con && x.nome), 'traz id_contato_con + nome (p/ dar a saída)');
  ok(extrairProprietariosAtuais([]).length === 0 && extrairProprietariosAtuais().length === 0, 'vazio/undefined -> []');
}

console.log(`test_titularidade: ${n}/${n} OK`);
