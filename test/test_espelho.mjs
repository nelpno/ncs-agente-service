// test_espelho.mjs — determinístico, sem Octadesk/Supabase reais (io injetável).
import assert from 'node:assert';
import { classificar, protocoloNcs, montarLinha, sincronizar } from '../src/espelho.mjs';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// classificar (triagem por assunto)
ok(classificar('Cadastro do meu filho para moradia').tipo === 'cadastro_dependente', 'dependente');
ok(classificar('Troca de titularidade de condominio').tipo === 'titularidade', 'titularidade');
ok(classificar('CND Edificio City Center').tipo === 'cnd', 'cnd');
ok(classificar('CND Edificio City Center').setor === 'Financeiro', 'cnd->Financeiro');
ok(classificar('Clube de vantagens').tipo === 'clube', 'clube');
ok(classificar('Confirmacao Presenca').tipo === 'evento', 'evento');
ok(classificar('cadastro morador e agendamento de mudanca').tipo === 'mudanca' || classificar('cadastro morador e agendamento de mudanca').tipo === 'cadastro_inquilino', 'mudanca/cadastro');
ok(classificar('assunto qualquer sem palavra chave').tipo === 'outro', 'outro');

// afinação do balde "outro" (amostra real de produção, 21/07)
ok(classificar('Entrega de Móveis').tipo === 'mudanca', 'moveis->mudanca');
ok(classificar('Retirada apenas da Máquina de lavar').tipo === 'mudanca', 'retirada->mudanca');
ok(classificar('informações para desocupação').tipo === 'mudanca', 'desocupacao->mudanca');
ok(classificar('Locação').tipo === 'cadastro_inquilino', 'locacao->cadastro_inquilino');
ok(classificar('Proposta de fornecimento de panos de chão').tipo === 'prestador', 'fornecimento->prestador');
ok(classificar('Proposta de fornecimento de panos de chão').setor === 'Comercial', 'prestador->Comercial');
ok(classificar('Minha parceria nro 1').tipo === 'prestador', 'parceria->prestador');
ok(classificar('Novo colaborador com excelência').tipo === 'prestador', 'colaborador->prestador');
ok(classificar('Currículo').tipo === 'prestador', 'curriculo->prestador');
ok(classificar('Club NCS').tipo === 'clube', 'club sem e->clube');
// genuinamente vagos: NÃO forçar, devem continuar "outro"
ok(classificar('.').tipo === 'outro', 'ponto->outro');
ok(classificar('ApN').tipo === 'outro', 'apn->outro');
ok(classificar('não entendi').tipo === 'outro', 'nao entendi->outro');
ok(classificar('Chat com Fulano').tipo === 'outro', 'chat com nome->outro');
ok(classificar('morador').tipo === 'outro', 'morador solto->outro');
ok(classificar('condomínio').tipo === 'outro', 'condominio solto->outro');
ok(classificar('Gruponcs').tipo === 'outro', 'gruponcs->outro');
ok(classificar('Malwee Araraquara').tipo === 'outro', 'nome de empresa sem keyword->outro (nao classifica por nome)');

// protocolo NCS
ok(protocoloNcs('344') === 'NCS-344', 'protocolo str');
ok(protocoloNcs(340, 'abc') === 'NCS-340', 'protocolo num');

// montarLinha + LGPD (nome sim, telefone/CPF NÃO)
const t = {
  id: 'oct1', number: 344, subject: 'Cadastro de inquilino',
  status: { name: 'Novo' },
  requester: { name: 'Joao Silva', phone: '5516999998888', cpf: '12345678900', email: 'joao@x.com' },
  createdAt: '2026-07-20T10:00:00Z',
};
const l = montarLinha(t);
ok(l.protocolo_ncs === 'NCS-344', 'linha protocolo');
ok(l.octadesk_id === 'oct1', 'linha id');
ok(l.tipo === 'cadastro_inquilino', 'linha tipo');
ok(l.requester === 'Joao Silva', 'requester nome');
ok(l.status === 'novo', 'status minusculo');
const linhaJson = JSON.stringify(l);
ok(!linhaJson.includes('5516999998888'), 'LGPD: linha SEM telefone');
ok(!linhaJson.includes('12345678900'), 'LGPD: linha SEM CPF');
ok(!linhaJson.includes('joao@x.com'), 'LGPD: linha SEM email');

// sincronizar com Supabase mock (in-memory) — upsert por octadesk_id
function mkIO(tickets) {
  const db = [];
  return {
    _db: db,
    listarTickets: async ({ page }) => (page === 1 ? tickets : []),
    sbSelect: async (_t, q) => {
      const m = q.match(/octadesk_id=eq\.([^&]+)/);
      const id = m && decodeURIComponent(m[1]);
      return db.filter((r) => r.octadesk_id === id).map((r) => ({ id: r._id, status: r.status }));
    },
    sbInsert: async (_t, row) => { const r = { ...row, _id: 'r' + db.length }; db.push(r); return r; },
    sbUpdate: async (_t, q, patch) => {
      const m = q.match(/id=eq\.([^&]+)/); const id = m && m[1];
      const r = db.find((x) => x._id === id); if (r) Object.assign(r, patch); return r ? [r] : [];
    },
  };
}
const io = mkIO([
  { id: 'a', number: 1, subject: 'Mudanca', status: { name: 'Novo' } },
  { id: 'b', number: 2, subject: 'CND', status: { name: 'Resolvido' } },
]);
const r1 = await sincronizar({ limit: 50, paginas: 1 }, io);
ok(r1.novos === 2 && r1.vistos === 2, '1a rodada: 2 novos');
ok(io._db.length === 2, 'db tem 2');

// 2a rodada: ticket 'a' mudou de status → atualizado; 'b' igual → inalterado; nada duplica
io.listarTickets = async ({ page }) => (page === 1 ? [
  { id: 'a', number: 1, subject: 'Mudanca', status: { name: 'Resolvido' } },
  { id: 'b', number: 2, subject: 'CND', status: { name: 'Resolvido' } },
] : []);
const r2 = await sincronizar({ limit: 50, paginas: 1 }, io);
ok(r2.novos === 0 && r2.atualizados === 1 && r2.inalterados === 1, '2a rodada: 1 atualizado 1 inalterado');
ok(io._db.length === 2, 'upsert não duplica (db ainda 2)');

console.log(`test_espelho: ${n}/${n} OK`);
