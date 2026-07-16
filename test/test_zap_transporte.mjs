// test_zap_transporte.mjs — o transporte de WhatsApp do outbox (zap.mjs) + a costura no outbox.
//
// O que este arquivo protege, em ordem de gravidade:
//  1. DESLIGADO = comportamento de HOJE, byte a byte ('pendente_humano' + 'transporte_zap_indefinido').
//     É isso que permite o arquivo entrar em produção sem mudar nada até alguém ligar a flag.
//  2. A allowlist barra endereço que não está nela — e o caso real disso NÃO é hipotético: condomínio
//     "Humana" roteia `sindico` → zap_individual, que é o CELULAR PESSOAL do síndico. Sem a allowlist,
//     um ensaio manda mensagem para uma pessoa de verdade.
//  3. Nunca finge envio: nada vira 'enviado' sem o transporte ter dito ok.
//
// Determinístico: zero rede (fetch é injetado), zero segredo. Roda no gate do CI.
import assert from 'node:assert';

let ok = 0;
const t = async (nome, fn) => {
  try { await fn(); console.log(`  ok  ${nome}`); ok++; }
  catch (e) { console.error(`  FALHOU  ${nome}\n      ${e.message}`); process.exitCode = 1; }
};

// Env limpo por caso — o módulo lê process.env a cada chamada (de propósito: dá pra ligar sem rebuild).
const comEnv = async (env, fn) => {
  const antes = { ...process.env };
  Object.assign(process.env, env);
  try { return await fn(); }
  finally {
    for (const k of Object.keys(process.env)) if (!(k in antes)) delete process.env[k];
    Object.assign(process.env, antes);
  }
};

const { enviarZap, zapPermitido, zapHabilitado } = await import('../src/zap.mjs');
const { enfileirarAvisos, processarPendentes, _memClear, _memAll } = await import('../src/outbox.mjs');

const GRUPO_TESTE = '120363410344964946@g.us';
const CELULAR_SINDICO = '5516999990000'; // fictício, no formato do dado real

console.log('\n[1] desligado = o comportamento que já existia (o default não muda nada)');

await t('sem ZAP_ENABLED → semRetry + motivo idêntico ao de antes', async () => {
  await comEnv({ ZAP_ENABLED: '', ZUCK_TOKEN: '' }, async () => {
    assert.equal(zapHabilitado(), false);
    const r = await enviarZap({ para: GRUPO_TESTE, texto: 'oi' });
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'transporte_zap_indefinido', 'o motivo mudou → a fila humana passa a mostrar outra coisa');
    assert.equal(r.semRetry, true, 'sem semRetry o outbox re-tentaria 5x uma decisão de configuração');
  });
});

await t('ZAP_ENABLED=true mas sem token → continua desligado (não tenta rede)', async () => {
  await comEnv({ ZAP_ENABLED: 'true', ZUCK_TOKEN: '' }, async () => {
    assert.equal(zapHabilitado(), false);
    assert.equal((await enviarZap({ para: GRUPO_TESTE, texto: 'oi' })).motivo, 'transporte_zap_indefinido');
  });
});

console.log('\n[2] allowlist: o freio que impede o ensaio de falar com gente de verdade');

await t('grupo de teste está na lista → permitido', async () => {
  await comEnv({ ZAP_ALLOWLIST: GRUPO_TESTE }, () => {
    assert.equal(zapPermitido(GRUPO_TESTE), true);
  });
});

await t('celular do síndico NÃO está na lista → barrado (o caso que importa)', async () => {
  await comEnv({ ZAP_ALLOWLIST: GRUPO_TESTE, ZAP_ENABLED: 'true', ZUCK_TOKEN: 'x' }, async () => {
    const r = await enviarZap({ para: CELULAR_SINDICO, texto: 'oi' });
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'fora_da_allowlist');
    assert.equal(r.semRetry, true);
  });
});

await t('allowlist vazia → nada sai, mesmo ligado', async () => {
  await comEnv({ ZAP_ALLOWLIST: '', ZAP_ENABLED: 'true', ZUCK_TOKEN: 'x' }, async () => {
    assert.equal((await enviarZap({ para: GRUPO_TESTE, texto: 'oi' })).motivo, 'fora_da_allowlist');
  });
});

await t('match é EXATO, não substring (senão um número casa com outro)', async () => {
  await comEnv({ ZAP_ALLOWLIST: '5516999990000' }, () => {
    assert.equal(zapPermitido('55169999900001'), false, 'substring passou → endereço errado receberia');
    assert.equal(zapPermitido('551699999000'), false);
    assert.equal(zapPermitido('5516999990000'), true);
  });
});

console.log('\n[3] a costura no outbox: quem manda no status da linha é o transporte');

const planoFake = async () => ({
  ok: true, condominio: 'ALLURE', tipo_portaria: 'Humana', sistema: 'Shielder',
  destinos: [
    { papel: 'portaria', canal: 'zap_grupo', endereco: GRUPO_TESTE, status: 'pronto', payload: 'texto do aviso' },
    { papel: 'sindico', canal: 'zap_individual', endereco: CELULAR_SINDICO, status: 'pronto', payload: 'texto do aviso' },
  ],
});
const deps = { sbEnabled: () => false, planejarAviso: planoFake };

await t('desligado → as DUAS linhas viram pendente_humano (nada é fingido)', async () => {
  _memClear();
  await enfileirarAvisos({ evento: 'cadastro', condominio: 'ALLURE' }, deps);
  const r = await processarPendentes({ sbEnabled: () => false, enviarZap: async () => ({ ok: false, motivo: 'transporte_zap_indefinido', semRetry: true }) });
  assert.equal(r.enviados, 0, 'algo foi dado como enviado sem transporte');
  assert.equal(r.pendente_humano, 2);
  assert.ok(_memAll().every((l) => l.status === 'pendente_humano' && l.ultimo_erro === 'transporte_zap_indefinido'));
});

await t('ligado c/ allowlist → grupo ENVIADO, síndico fica pendente (não vaza p/ pessoa real)', async () => {
  _memClear();
  await enfileirarAvisos({ evento: 'cadastro', condominio: 'ALLURE' }, deps);
  const enviarZapFake = async ({ para }) => (para === GRUPO_TESTE
    ? { ok: true, id: 'ABC123' }
    : { ok: false, motivo: 'fora_da_allowlist', semRetry: true });
  const r = await processarPendentes({ sbEnabled: () => false, enviarZap: enviarZapFake });
  assert.equal(r.enviados, 1, 'o grupo de teste tinha que receber');
  assert.equal(r.pendente_humano, 1, 'o síndico tinha que ficar na fila humana');
  const grupo = _memAll().find((l) => l.canal === 'zap_grupo');
  const sind = _memAll().find((l) => l.canal === 'zap_individual');
  assert.equal(grupo.status, 'enviado');
  assert.ok(grupo.enviado_em, 'enviado sem carimbo de hora');
  assert.equal(sind.status, 'pendente_humano');
  assert.equal(sind.ultimo_erro, 'fora_da_allowlist');
});

await t('erro de rede → re-tenta (fica pendente), NÃO vai direto pra fila humana', async () => {
  _memClear();
  await enfileirarAvisos({ evento: 'cadastro', condominio: 'ALLURE' }, deps);
  const r = await processarPendentes({ sbEnabled: () => false, enviarZap: async () => ({ ok: false, motivo: 'erro_zuck' }) });
  assert.equal(r.pendente_humano, 0);
  assert.ok(_memAll().every((l) => l.status === 'pendente' && l.tentativas === 1), 'timeout devia ser re-tentável');
});

console.log(`\ntest_zap_transporte: ${ok} OK`);
