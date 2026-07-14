// test_outbox.mjs — outbox de notificações (spec Onda 1 §4.3): enfileirar, processar (retry/zap-indefinido),
// listar pendências. Determinístico: sbEnabled:()=>false força o fallback in-memory (nunca toca Supabase real);
// enviarEmail/planejarAviso são injetados via deps quando precisamos de controle total do cenário.
import {
  enfileirarAvisos, processarPendentes, listarPendencias, startOutboxWorker,
  _memClear, _memAll, MAX_TENTATIVAS,
} from '../src/outbox.mjs';
import { planejarAviso as _planejarAvisoReal } from '../src/portaria_dispatch.mjs';

let ok = 0, fail = 0;
const check = (n, c) => { if (c) ok++; else { fail++; console.log(`  ❌ ${n}`); } };
// Determinístico: injeta o planejarAviso real com contatos VAZIOS — não lê o JSON de produção (que já tem os
// contatos reais), então os cenários "sem contato cadastrado" abaixo permanecem válidos e estáveis.
const dep = { sbEnabled: () => false, planejarAviso: (a) => _planejarAvisoReal({ ...a, contatos: {} }) };
const ator = { nome: 'Fulano', papel: 'inquilino', unidade: 'Apto 42', telefone: '16 99999-0000' };

// --- enfileirarAvisos (usa o portaria_dispatch real + JSON de produção, hoje sem contatos) ---

// 1) Humana (Lume) → 2 destinos (zap_grupo+zap_individual), sem contato cadastrado → ambos pendente_humano
_memClear();
const e1 = await enfileirarAvisos({ evento: 'cadastro', condominio: 'Lume', ator }, dep);
check('Lume → ok, 2 enfileirados', e1.ok === true && e1.enfileirados === 2);
check('Lume → 2 pendente_humano (sem contato)', e1.pendente_humano === 2);
check('Lume → canais certos (zap_grupo + zap_individual)', e1.linhas.some((l) => l.canal === 'zap_grupo') && e1.linhas.some((l) => l.canal === 'zap_individual'));
check('Lume → papéis certos (portaria + sindico)', e1.linhas.some((l) => l.papel === 'portaria') && e1.linhas.some((l) => l.papel === 'sindico'));
check('Lume → status pendente_humano nas 2 linhas', e1.linhas.every((l) => l.status === 'pendente_humano'));

// 2) Virtual (Aristocrata) → portaria por e-mail JÁ conhecido (sistema) → pendente; síndico sem contato → pendente_humano
_memClear();
const e2 = await enfileirarAvisos({ evento: 'cadastro', condominio: 'Aristocrata', ator }, dep);
check('Aristocrata → ok, 2 enfileirados', e2.ok === true && e2.enfileirados === 2);
check('Aristocrata → 1 pendente_humano (só o síndico)', e2.pendente_humano === 1);
const portariaLinha = e2.linhas.find((l) => l.papel === 'portaria');
check('Aristocrata → portaria email pendente (endereço conhecido)', portariaLinha?.canal === 'email' && portariaLinha?.status === 'pendente' && portariaLinha?.endereco === 'portaria@alarmsystem.com.br');
const sindicoLinha = e2.linhas.find((l) => l.papel === 'sindico');
check('Aristocrata → síndico pendente_humano (sem whatsapp)', sindicoLinha?.status === 'pendente_humano');

// 3) condomínio não resolvido → ok:false, nada enfileirado
_memClear();
const e3 = await enfileirarAvisos({ evento: 'cadastro', condominio: 'Inexistente XPTO', ator }, dep);
check('desconhecido → ok:false', e3.ok === false && e3.enfileirados === 0 && e3.pendente_humano === 0 && e3.linhas.length === 0);

// 4) draftId propaga pra todas as linhas
_memClear();
const e4 = await enfileirarAvisos({ evento: 'cadastro', condominio: 'Lume', ator, draftId: 'draft-abc123' }, dep);
check('draftId propaga em todas as linhas', e4.linhas.every((l) => l.draft_id === 'draft-abc123'));

// --- processarPendentes (in-memory) ---

// 5) e-mail com sucesso → 'enviado' + enviado_em; a linha pendente_humano do síndico não é tocada
_memClear();
await enfileirarAvisos({ evento: 'cadastro', condominio: 'Aristocrata', ator }, dep);
const r5 = await processarPendentes({ sbEnabled: () => false, enviarEmail: async () => ({ ok: true }) });
check('processarPendentes → processa só a linha "pendente" (a de e-mail)', r5.processados === 1 && r5.enviados === 1);
const linhaEnviada = _memAll().find((l) => l.canal === 'email');
check('linha de e-mail → enviado + enviado_em setado', linhaEnviada?.status === 'enviado' && !!linhaEnviada?.enviado_em);
const linhaSindicoIntacta = _memAll().find((l) => l.papel === 'sindico');
check('linha pendente_humano do síndico não foi mexida', linhaSindicoIntacta?.status === 'pendente_humano');

// 6) e-mail falhando repetidamente → tentativas sobe, só vira pendente_humano ao atingir MAX_TENTATIVAS
_memClear();
const planoEmailFake = async () => ({
  ok: true, condominio: 'Teste', tipo_portaria: 'Virtual',
  destinos: [{ papel: 'portaria', canal: 'email', via: null, endereco: 'x@test.com', status: 'pronto', payload: 'oi' }],
});
await enfileirarAvisos({ evento: 'cadastro', condominio: 'Teste', ator }, { sbEnabled: () => false, planejarAviso: planoEmailFake });
const enviarEmailFalha = async () => ({ ok: false, motivo: 'erro_smtp' });
const r6a = await processarPendentes({ sbEnabled: () => false, enviarEmail: enviarEmailFalha });
check('1ª falha → processou 1, continua pendente (não é MAX ainda)', r6a.processados === 1 && r6a.pendente_humano === 0);
check('1ª falha → tentativas=1, status ainda pendente', _memAll()[0].status === 'pendente' && _memAll()[0].tentativas === 1);
for (let i = 0; i < MAX_TENTATIVAS - 1; i++) await processarPendentes({ sbEnabled: () => false, enviarEmail: enviarEmailFalha });
const linhaExaurida = _memAll()[0];
check(`após ${MAX_TENTATIVAS} falhas → pendente_humano`, linhaExaurida.status === 'pendente_humano' && linhaExaurida.tentativas === MAX_TENTATIVAS);
check('ultimo_erro registrado', linhaExaurida.ultimo_erro === 'erro_smtp');

// 7) canal zap_* → NUNCA finge envio; vira pendente_humano na hora, com motivo explícito (transporte §5 não decidido)
_memClear();
const planoZapFake = async () => ({
  ok: true, condominio: 'Teste', tipo_portaria: 'Humana',
  destinos: [{ papel: 'sindico', canal: 'zap_individual', via: null, endereco: '5516999990000', status: 'pronto', payload: 'oi' }],
});
await enfileirarAvisos({ evento: 'cadastro', condominio: 'Teste', ator }, { sbEnabled: () => false, planejarAviso: planoZapFake });
const r7 = await processarPendentes({ sbEnabled: () => false });
check('zap → processado e vira pendente_humano (1 passada, sem retry)', r7.processados === 1 && r7.pendente_humano === 1 && r7.enviados === 0);
check('zap → ultimo_erro = transporte_zap_indefinido (honesto, não finge envio)', _memAll()[0].ultimo_erro === 'transporte_zap_indefinido' && _memAll()[0].status === 'pendente_humano');

// 8) canal desconhecido → também vira pendente_humano (nada some)
_memClear();
const planoCanalDesconhecido = async () => ({
  ok: true, condominio: 'Teste', tipo_portaria: 'Humana',
  destinos: [{ papel: 'portaria', canal: 'web_form', via: null, endereco: 'x', status: 'pronto', payload: 'oi' }],
});
await enfileirarAvisos({ evento: 'cadastro', condominio: 'Teste', ator }, { sbEnabled: () => false, planejarAviso: planoCanalDesconhecido });
const r8 = await processarPendentes({ sbEnabled: () => false });
check('canal desconhecido → pendente_humano com motivo', r8.pendente_humano === 1 && /canal_desconhecido/.test(_memAll()[0].ultimo_erro || ''));

// 9) exceção inesperada no envio → 'falhou' (distinto de pendente_humano)
_memClear();
await enfileirarAvisos({ evento: 'cadastro', condominio: 'Teste', ator }, { sbEnabled: () => false, planejarAviso: planoEmailFake });
const r9 = await processarPendentes({ sbEnabled: () => false, enviarEmail: async () => { throw new Error('boom'); } });
check('exceção → conta como "falhou", não pendente_humano', r9.falhou === 1 && r9.pendente_humano === 0);
check('linha marcada "falhou" com o erro', _memAll()[0].status === 'falhou' && _memAll()[0].ultimo_erro === 'boom' && _memAll()[0].tentativas === 1);

// --- listarPendencias ---

// 10) só pendente_humano/falhou aparecem; 'enviado' e 'pendente' ficam de fora
_memClear();
await enfileirarAvisos({ evento: 'cadastro', condominio: 'Aristocrata', ator }, dep); // 1 pendente (email) + 1 pendente_humano (sindico)
await processarPendentes({ sbEnabled: () => false, enviarEmail: async () => ({ ok: true }) }); // email → enviado
const pend10 = await listarPendencias({ sbEnabled: () => false });
check('listarPendencias → só o síndico (pendente_humano), não o e-mail já enviado', pend10.length === 1 && pend10[0].papel === 'sindico');

// --- caminho Supabase (fakes; nunca toca o banco real) ---

// 11) enfileirarAvisos + processarPendentes + listarPendencias via sbInsert/sbSelect/sbUpdate fakes
const fakeDb = [];
const sbEnabledTrue = () => true;
const sbInsertFake = async (table, row) => {
  const saved = { ...row, id: 'sb' + fakeDb.length, tentativas: 0, ultimo_erro: null, criado_em: new Date().toISOString(), enviado_em: null };
  fakeDb.push(saved);
  return saved;
};
const e11 = await enfileirarAvisos({ evento: 'cadastro', condominio: 'Aristocrata', ator }, { sbEnabled: sbEnabledTrue, sbInsert: sbInsertFake });
check('Supabase (fake) → enfileira via sbInsert', e11.ok === true && e11.enfileirados === 2 && fakeDb.length === 2);

const sbSelectPendentesFake = async (table, query) => { check('sbSelect (processar) filtra status=eq.pendente', query.includes('status=eq.pendente')); return fakeDb.filter((r) => r.status === 'pendente'); };
const sbUpdateFake = async (table, query, patch) => {
  const idMatch = query.match(/id=eq\.([^&]+)/);
  const row = idMatch ? fakeDb.find((r) => r.id === idMatch[1]) : null;
  if (row) Object.assign(row, patch);
  return row ? [row] : [];
};
const r11 = await processarPendentes({ sbEnabled: sbEnabledTrue, sbSelect: sbSelectPendentesFake, sbUpdate: sbUpdateFake, enviarEmail: async () => ({ ok: true }) });
check('Supabase (fake) → processa e marca enviado via sbUpdate', r11.enviados === 1 && fakeDb.find((r) => r.canal === 'email')?.status === 'enviado');

const sbSelectPendFake = async (table, query) => { check('sbSelect (listarPendencias) filtra pendente_humano,falhou', query.includes('pendente_humano') && query.includes('falhou')); return fakeDb.filter((r) => r.status === 'pendente_humano' || r.status === 'falhou'); };
const pend11 = await listarPendencias({ sbEnabled: sbEnabledTrue, sbSelect: sbSelectPendFake });
check('Supabase (fake) → listarPendencias devolve só pendente_humano/falhou', pend11.length === 1 && pend11[0].papel === 'sindico');

// --- startOutboxWorker: só garante que sobe/desce sem lançar (não deixa o processo de teste vivo) ---
const timer = startOutboxWorker({ intervalMs: 999999 });
check('startOutboxWorker → devolve um timer', !!timer);
clearInterval(timer);

console.log(`\n${fail === 0 ? '✅' : '❌'} outbox: ${ok} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
