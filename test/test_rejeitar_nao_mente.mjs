// test_rejeitar_nao_mente.mjs — rejeitar que FUNCIONOU não pode aparecer como erro na tela.
//
// Defeito 11 do teste dos 20 (07/08/2026): o Fernando clicou em "Rejeitar", a tela deu erro, e o
// banco tinha gravado `rejeitado` certinho. Motivo: em `executarRejeicao` o estado muda primeiro e
// só DEPOIS vêm os efeitos colaterais (auditoria e aviso ao morador) — que não estavam protegidos.
// Se qualquer um deles falha, a exceção sobe, o Portal recebe 502 e mostra "não foi possível
// concluir agora" para uma ação que aconteceu. Aí a pessoa clica de novo, ou pior: acha que o
// cadastro segue pendente quando já foi devolvido.
//
// A regra que este teste tranca: **depois que o estado mudou, nada pode transformar a operação em
// falha.** É o mesmo tratamento que `fecharFilaDoDraft` e `posGravar` já tinham neste arquivo.
//
// ⚠️ NÃO vale para o evento `pre_gravacao` da aprovação: aquele é a rede de segurança do incidente
// de 23/07 (snapshot ANTES de escrever no ERP) e roda ANTES da escrita — falhar ali tem de abortar.
// O último caso deste arquivo prova que ele continua fail-closed.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// A auditoria cai em arquivo quando não há Supabase. Apontando o caminho para um DIRETÓRIO, todo
// `registrarEvento` falha com EISDIR — é o jeito determinístico de simular a auditoria fora do ar.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ncs-audit-'));
process.env.AUDIT_LOG_PATH = dir;
process.env.DRY_RUN_WRITES = 'true';

const { criarRascunho, rejeitarRascunho } = await import('../src/write/engine.mjs');
const { registerAction } = await import('../src/write/registry.mjs');
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

// Confirma a premissa: com AUDIT_LOG_PATH apontando para um diretório, a auditoria REALMENTE falha.
// Sem esta checagem o teste passaria verde sem nunca ter exercitado o cenário.
const { registrarEvento } = await import('../src/write/auditoria.mjs');
let auditoriaFalha = false;
try { await registrarEvento({ tipo: 'teste', draftId: 'x' }); } catch { auditoriaFalha = true; }
ok(auditoriaFalha, 'PREMISSA: a auditoria está mesmo falhando neste cenário');

registerAction({
  id: 'fake_rejeicao', descricao: 'ação de teste', timeAprovador: 'Recepção',
  validar: (d) => ({ ok: !!d?.nome, erros: d?.nome ? [] : ['faltou nome'] }),
  montarPayload: (d) => ({ nome: d.nome }),
  gravar: async () => ({ ok: true, dryRun: true }),
});

const cr = await criarRascunho('fake_rejeicao', { nome: 'Simone Teste' }, {});
ok(cr.ok === true, 'rascunho criado mesmo com a auditoria fora (criar também não pode depender dela)');

const rej = await rejeitarRascunho(cr.token, { aprovador: { nome: 'Fernando' }, motivo: 'dados divergentes' });
ok(rej.ok === true && rej.rejeitado === true, 'rejeição com auditoria fora → ok:true (a tela não mente sobre o que aconteceu)');

// E o estado tem de estar REALMENTE rejeitado — "ok:true" sem o efeito seria o defeito ao contrário.
const { getDraftByToken } = await import('../src/write/drafts.mjs');
const d = await getDraftByToken(cr.token);
ok(d?.status === 'rejeitado', `o rascunho está de fato rejeitado (está "${d?.status}")`);

// Rejeitar de novo o mesmo rascunho continua respondendo sem explodir (a pessoa clica duas vezes).
const rej2 = await rejeitarRascunho(cr.token, { aprovador: { nome: 'Fernando' } });
ok(rej2.ok === true, 'rejeitar duas vezes não vira erro na tela');

// Token que não existe continua sendo um NÃO honesto — o guard não pode virar "tudo dá certo".
const inex = await rejeitarRascunho('token-que-nao-existe', { aprovador: { nome: 'Fernando' } });
ok(inex.ok === false && inex.motivo === 'nao_encontrado', 'CONTROLE: token inexistente segue devolvendo erro');

// 🔴 A rede de segurança do incidente de 23/07 continua fail-closed: o snapshot `pre_gravacao` roda
// ANTES de escrever no ERP, e se ele não puder ser registrado a aprovação NÃO acontece.
const cr2 = await criarRascunho('fake_rejeicao', { nome: 'Outro Teste' }, {});
const { aprovarRascunho } = await import('../src/write/engine.mjs');
let aprovouSemRede = true;
try {
  const ap = await aprovarRascunho(cr2.token, { aprovador: { nome: 'Fernando' } });
  aprovouSemRede = ap.ok === true;
} catch { aprovouSemRede = false; }
ok(!aprovouSemRede, 'aprovação NÃO acontece quando o snapshot pré-gravação não pôde ser registrado');

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
