// _smoke_integ_onda1.mjs — smoke de INTEGRAÇÃO da Onda 1 (temporário; apagar após rodar).
// Liga a cadeia REAL: executor HTTP (server.criarHandlerAprovar) -> engine (CAS/aprovarRascunhoPorId)
// -> gravar (dryRun) -> posGravar -> outbox (enfileirarAvisos). Tudo em memória (sbEnabled=false).
// Único stub: o gravar da action (em prod é dryRun de qualquer forma). Prova a costura A+B+D.
import { registerAction } from '../src/write/registry.mjs';
import { criarRascunho } from '../src/write/engine.mjs';
import * as engine from '../src/write/engine.mjs';
import { criarHandlerAprovar } from '../server.mjs';
import { enfileirarAvisos, _memAll, _memClear } from '../src/outbox.mjs';

let ok = 0, fail = 0;
const A = (cond, msg) => (cond ? (ok++, console.log('  OK  ' + msg)) : (fail++, console.log('  FALHA ' + msg)));

// Action de teste: gravar simulado + posGravar REAL (enfileira no outbox). Sem tocar Superlógica.
registerAction({
  id: 'smoke_cadastro',
  descricao: 'smoke de integração',
  timeAprovador: 'Recepção',
  validar: (d) => ({ ok: !!d?.nome, erros: d?.nome ? [] : ['faltou nome'] }),
  montarPayload: (d) => ({ 'contatos[0][ST_NOME_CON]': d.nome }),
  gravar: async () => ({ ok: true, dryRun: true, resposta: 'SMOKE dry', idCriado: null, candidatosId: [] }),
  posGravar: async (dados) => enfileirarAvisos({
    evento: 'cadastro', condominio: dados.condominio_nome,
    ator: { nome: dados.nome, papel: 'inquilino', unidade: dados.unidade_label, telefone: dados.telefone },
  }),
});

if (_memClear) _memClear();

// 1) Criar rascunho pela via real do engine.
const dados = { nome: 'Fulano Smoke', condominio_nome: 'Lume', unidade_label: 'Apto 13B', telefone: '5516999990000' };
const c = await criarRascunho('smoke_cadastro', dados, { solicitante: 'smoke' });
A(c.ok === true, 'criarRascunho ok');
A(typeof c.draftId === 'string' && c.draftId.length > 0, 'draftId gerado');

// 2) Aprovar via o HANDLER HTTP real (o que o Portal chama), passando a fn do engine.
const handler = criarHandlerAprovar({ aprovarRascunhoPorId: engine.aprovarRascunhoPorId });
const r = await handler({ draft_id: c.draftId, aprovador: { user_id: 'u1', nome: 'Aprovador', papel: 'admin' } });
A(r.status === 200, `handler status 200 (got ${r.status})`);
A(r.json?.ok === true && r.json?.gravado === true, 'handler retornou gravado');
A(r.json?.dryRun === true, 'gravação em dryRun (nada real)');

// 3) posGravar enfileirou avisos no outbox — e sem contato (JSON vazio p/ Lume) => pendente_humano (fila visível).
const avisos = _memAll ? _memAll() : [];
A(avisos.length >= 1, `outbox recebeu ${avisos.length} aviso(s)`);
A(avisos.every((n) => n.status === 'pendente_humano' || n.status === 'pendente'), 'avisos entraram na fila (status válido)');
A(avisos.some((n) => n.status === 'pendente_humano'), 'sem contato => pendente_humano (nada falha calado)');
console.log('  destinos:', avisos.map((n) => `${n.papel}/${n.canal}/${n.status}`).join(', '));

// 4) CAS na cadeia integrada: 2 aprovações concorrentes do MESMO draft => 1 grava, a outra não regrava.
if (_memClear) _memClear();
const c2 = await criarRascunho('smoke_cadastro', dados, { solicitante: 'smoke' });
const [ra, rb] = await Promise.all([
  handler({ draft_id: c2.draftId, aprovador: { user_id: 'a', nome: 'A', papel: 'admin' } }),
  handler({ draft_id: c2.draftId, aprovador: { user_id: 'b', nome: 'B', papel: 'admin' } }),
]);
const gravados = [ra, rb].filter((x) => x.json?.gravado === true).length;
const bloqueados = [ra, rb].filter((x) => x.json?.motivo === 'ja_em_processamento' || x.json?.jaGravado === true).length;
A(gravados === 1, `CAS: exatamente 1 gravou (got ${gravados})`);
A(bloqueados === 1, `CAS: a 2ª foi barrada (got ${bloqueados})`);

console.log(`\n${fail === 0 ? '✅' : '❌'} smoke integração Onda 1: ${ok} OK, ${fail} FALHA`);
process.exit(fail === 0 ? 0 : 1);
