// test_fila_ana.mjs — F1 (a Ana carimba o ticket direto na fila `solicitacoes`).
// Determinístico, sem Supabase real (io injetável, molde do test_espelho). Roda no gate do CI.
// Prova: (1) flag off = byte-idêntico ao de hoje (nada insere); (2) flag on grava origem/status
// PRÓPRIOS ('ana'/'aberta'); (3) LGPD — assunto sanitizado (sem CPF/telefone/email); (4) vínculo draft_id.
import assert from 'node:assert';
import { registrarSolicitacao, sanitizarAssunto } from '../src/fila.mjs';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// io mock: sbInsert devolve a linha com numero (identity) + id; sbUpdate casa por id (protocolo 2-step)
function mkIO() {
  const db = [];
  let seq = 100;
  return {
    _db: db,
    sbInsert: async (_t, row) => { const r = { ...row, id: 'r' + db.length, numero: ++seq }; db.push(r); return r; },
    sbUpdate: async (_t, q, patch) => {
      const m = q.match(/id=eq\.([^&]+)/); const id = m && m[1];
      const r = db.find((x) => x.id === id); if (r) Object.assign(r, patch); return r ? [r] : [];
    },
  };
}

// ---------------------------------------------------- 1) flag OFF = comportamento de sempre
delete process.env.FILA_ANA_ENABLED;
{
  const io = mkIO();
  const r = await registrarSolicitacao({ assunto: 'Vazamento no apartamento' }, io);
  ok(r.ok === false && r.motivo === 'desligado', 'flag off: nao registra');
  ok(io._db.length === 0, 'flag off: NAO chama sbInsert (prod byte-identico)');
}

// ---------------------------------------------------- 2) flag ON: linha com origem/status proprios
process.env.FILA_ANA_ENABLED = 'true';
{
  const io = mkIO();
  const r = await registrarSolicitacao({ assunto: 'Vazamento no apartamento', canal: 'whatsapp', requester: 'Maria Souza' }, io);
  ok(r.ok === true, 'flag on: registra ok');
  ok(io._db.length === 1, 'inseriu 1 linha');
  const row = io._db[0];
  ok(row.origem === 'ana', 'origem = ana (nao espelho do Octa)');
  ok(row.status === 'aberta', 'status PROPRIO = aberta (nao herda "resolvido" do Octa)');
  ok(row.tipo === 'ocorrencia', 'tipo classificado (vazamento -> ocorrencia)');
  ok(row.setor === 'Gerência', 'setor coerente com o tipo');
  ok(row.requester === 'Maria Souza', 'requester nome preservado');
  ok(r.protocolo === 'NCS-A-' + row.numero, 'protocolo proprio da Ana com numero');
  ok(row.protocolo_ncs === 'NCS-A-' + row.numero, 'protocolo_ncs gravado (2-step via update)');
}

// ---------------------------------------------------- 3) tipo EXPLICITO (caso escrita-ERP) + draft_id
{
  const io = mkIO();
  const r = await registrarSolicitacao(
    { tipo: 'cadastro_inquilino', assunto: 'Cadastro de inquilino - Lume', draftId: 'draft-xyz' }, io);
  ok(r.ok === true, 'ERP: registra ok');
  const row = io._db[0];
  ok(row.tipo === 'cadastro_inquilino', 'tipo explicito respeitado');
  ok(row.setor === 'Recepção', 'setor derivado do tipo explicito');
  ok(row.draft_id === 'draft-xyz', 'vinculo com o rascunho (draft_id)');
}

// ---------------------------------------------------- 4) LGPD: assunto sem CPF/telefone/email
{
  const suja = 'Cadastro CPF 123.456.789-00 telefone 16999998888 email joao@x.com';
  const limpo = sanitizarAssunto(suja);
  ok(!/\d[\d.\-]{3,}\d/.test(limpo), 'sanitiza sequencias longas de digitos (CPF/telefone)');
  ok(!limpo.includes('@'), 'sanitiza email');
  const io = mkIO();
  await registrarSolicitacao({ assunto: suja }, io);
  const j = JSON.stringify(io._db[0].assunto);
  ok(!j.includes('123.456.789-00') && !j.includes('16999998888') && !j.includes('joao@x.com'), 'linha gravada SEM PII');
  // unidade de 4 digitos ("0101") NAO e mascarada (nao e PII)
  ok(sanitizarAssunto('mudanca apto 0101').includes('0101'), 'nao mascara numero de unidade (4 digitos)');
}

console.log(`test_fila_ana: ${n}/${n} OK`);
