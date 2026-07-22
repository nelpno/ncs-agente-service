// test_fila_ana.mjs — F1 (a Ana carimba o ticket direto na fila `solicitacoes`).
// Determinístico, sem Supabase real (io injetável, molde do test_espelho). Roda no gate do CI.
// Prova: (1) flag off = byte-idêntico ao de hoje (nada insere); (2) flag on grava origem/status
// PRÓPRIOS ('ana'/'aberta'); (3) LGPD — assunto sanitizado (sem CPF/telefone/email); (4) vínculo draft_id.
import assert from 'node:assert';
import { registrarSolicitacao, sanitizarAssunto, decidirHandoff, marcarPorDraft } from '../src/fila.mjs';

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

// ---------------------------------------------------- 5) Decisão (b): estreitar o handoff.
// So HANDOFF ESTRUTURADO (ocorrencia/mudanca/titularidade) vira linha na fila. Handoff PURO
// ("quero um humano" -> tipo 'outro') NAO cria linha: a conversa do Chatwoot ja e o ticket.
// decidirHandoff e PURA (nao checa a flag) -> testavel sem rede.
{
  // handoff PURO nao registra (Decisão b, nucleo)
  ok(decidirHandoff('pessoa_pediu_humano', 'Morador so quer falar com um atendente').registrar === false, 'handoff puro nao registra');
  ok(decidirHandoff('fora_de_escopo', '').registrar === false, 'fora_de_escopo nao registra');
  ok(decidirHandoff('nao_resolvido', 'nao consegui resolver').registrar === false, 'nao_resolvido nao registra');
  ok(decidirHandoff('assembleia_sindico', 'quer falar sobre a assembleia').registrar === false, 'assembleia nao registra');

  // mudanca pelo MOTIVO (enum agendamento_mudanca -> mudanca) + assunto enriquecido (item 6 = resumo)
  const m = decidirHandoff('agendamento_mudanca', 'Morador quer agendar mudanca dia 30, o formulario nao abriu');
  ok(m.registrar === true && m.tipo === 'mudanca', 'agendamento_mudanca -> mudanca');
  ok(m.assunto === 'Morador quer agendar mudanca dia 30, o formulario nao abriu', 'assunto = resumo (item 6, enriquecido)');

  // ocorrencia pelo RESUMO (motivo generico, resumo estruturado = 2a chance)
  const o = decidirHandoff('pessoa_pediu_humano', 'Vazamento no teto do banheiro, quer que a NCS resolva');
  ok(o.registrar === true && o.tipo === 'ocorrencia', 'vazamento no resumo -> ocorrencia (2a chance)');

  // reclamacao (enum) -> ocorrencia (Gerencia)
  ok(decidirHandoff('reclamacao', 'Insatisfeito com o barulho da obra').tipo === 'ocorrencia', 'reclamacao -> ocorrencia');

  // titularidade pelo resumo, mesmo com motivo cadastro_pendente
  const t = decidirHandoff('cadastro_pendente', 'Comprei o apartamento, quero fazer a troca de titularidade');
  ok(t.registrar === true && t.tipo === 'titularidade', 'resumo de titularidade -> titularidade');

  // FALSO POSITIVO barrado: falha de lookup de cadastro NAO vira linha (familia cadastro fora do WL).
  // O resumo classifica como cadastro_inquilino, mas cadastro_* nao entra por handoff (entra pela criar_rascunho_cadastro).
  ok(decidirHandoff('cadastro_nao_encontrado', 'Nao localizei o cadastro do inquilino Joao no sistema').registrar === false, 'lookup de cadastro falho NAO registra');

  // cobranca / RH fora (frente propria / formulario)
  ok(decidirHandoff('renegociacao', 'Quer parcelar o debito').registrar === false, 'renegociacao nao registra');
  ok(decidirHandoff('boleto_mais_30_dias', 'Boleto vencido, quer negociar').registrar === false, 'cobranca +30d nao registra');
  ok(decidirHandoff('rh', 'Segunda via do holerite').registrar === false, 'rh nao registra');

  // ECLIPSE PIN: "vazamento + desconto no boleto" -> classifica boleto (regra 6 antes de ocorrencia 11) -> NAO registra.
  // Pino documental: se alguem reordenar as REGRAS do espelho.mjs, este teste VIRA e o comportamento fica visivel.
  ok(decidirHandoff('pessoa_pediu_humano', 'Tem um vazamento e por isso quero desconto no boleto').registrar === false, 'ECLIPSE (pino): boleto ofusca ocorrencia no resumo');

  // DEDUP por sessao: ja carimbou um handoff nesta sessao -> nao repete a linha
  ok(decidirHandoff('agendamento_mudanca', 'mudanca dia 30', true).registrar === false, 'dedup: handoff ja registrado na sessao nao repete');
}

// ---------------------------------------------------- 6) F2: marcarPorDraft fecha a linha ao aprovar o rascunho
{
  process.env.FILA_ANA_ENABLED = 'true';
  let cap = null;
  const io = { sbUpdate: async (_t, q, patch) => { cap = { q, patch }; return [{ id: 'r1' }]; } };
  const r = await marcarPorDraft('draft-xyz', 'resolvida', { por: 'Fernando' }, io);
  ok(r.ok === true && r.atualizadas === 1, 'marcarPorDraft: ok, 1 atualizada');
  ok(/draft_id=eq\.draft-xyz/.test(cap.q), 'WHERE por draft_id (nunca a fila inteira)');
  ok(cap.patch.status === 'resolvida', 'seta status resolvida');
  ok(cap.patch.resolvido_por === 'Fernando' && !!cap.patch.resolvido_em, 'seta resolvido_por + resolvido_em');

  // ⚠️ guarda CRITICA: sem draft_id NAO pode rodar UPDATE (fecharia TODA a fila).
  const nod = await marcarPorDraft('', 'resolvida', {}, io);
  ok(nod.ok === false && nod.motivo === 'sem_draft', 'sem draft_id = no-op (nao fecha a fila toda)');

  // fecha INDEPENDENTE da flag: FILA_ANA_ENABLED gateia a CRIACAO da linha, nao o fechamento (senao
  // rollback da flag com linhas abertas deixaria zumbis, e o Portal que lista nem conhece a flag).
  delete process.env.FILA_ANA_ENABLED;
  cap = null;
  const off = await marcarPorDraft('draft-xyz', 'resolvida', {}, io);
  ok(off.ok === true && /draft_id=eq\.draft-xyz/.test(cap.q), 'fecha mesmo com a flag off');
  process.env.FILA_ANA_ENABLED = 'true';
}

console.log(`test_fila_ana: ${n}/${n} OK`);
