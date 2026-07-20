// test_cobranca_leva.mjs — orquestrador montarLevaCondo: junta resumo (contato) + detalhe (encargos) + garantidora
// + tentativas do CRM → normaliza → classifica (3 baldes) → aplica a régua por unidade. Testado com deps INJETADAS
// (sem API/PII). Prova a orquestração ponta-a-ponta offline.
import { montarLevaCondo } from '../src/cobranca/leva.mjs';

let falhas = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK ' : 'FALHA'} ${msg}`); if (!cond) falhas++; };

// fixtures no shape real (resumo tem contato; detalhe tem recebimento[].encargos)
const resumo = [
  { id_unidade_uni: 'A', st_email_con: 'a@x.com', st_cpf_con: '111', st_nome_con: 'Ana' },   // pronto, atraso 90 → régua etapa 1
  { id_unidade_uni: 'B', st_email_con: '', st_cpf_con: '222', st_nome_con: 'Bruno' },          // sem email → bloqueado
  { id_unidade_uni: 'C', st_email_con: 'c@x.com', st_cpf_con: '333', st_nome_con: 'Célia' },   // elegível (31d ≥ 30) MAS pré-marco 33 → régua aguardando
];
const boleto = (dias, over = {}) => ({ id_recebimento_recb: '1', vl_total_recb: '500', id_processo_proc: '', id_acordo_recb: '',
  encargos: [{ detalhes: { juros: '10', multa: '10', atualizacaomonetaria: '0' }, taxas: { juros: '1.00', multa: '2.00' }, valorcorrigido: '640', diasatraso: String(dias) }], ...over });
const detalhes = {
  A: { id_unidade_uni: 'A', st_unidade_uni: '101', id_condominio_cond: '181', processos: [], recebimento: [boleto(90)] },
  B: { id_unidade_uni: 'B', st_unidade_uni: '102', id_condominio_cond: '181', processos: [], recebimento: [boleto(90)] },
  C: { id_unidade_uni: 'C', st_unidade_uni: '103', id_condominio_cond: '181', processos: [], recebimento: [boleto(31)] },
};

let chamadasDetalhe = 0;
const deps = {
  listarResumo: async (condId) => { ok(condId === 181, `listarResumo recebe condId 181 (${condId})`); return resumo; },
  detalharUnidade: async (condId, uid) => { chamadasDetalhe++; return detalhes[uid]; },
  garantidoraDe: () => null,
  contarTentativas: async () => 0,
};

const leva = await montarLevaCondo(181, deps);

ok(chamadasDetalhe === 3, `detalhou as 3 unidades (${chamadasDetalhe})`);
ok(leva.condominio_id === 181, `leva.condominio_id = 181 (${leva.condominio_id})`);

const byId = Object.fromEntries(leva.unidades.map((u) => [u.unidade.id_unidade, u]));
ok(byId.A.balde === 'pronto', `A -> pronto (${byId.A.balde})`);
ok(byId.A.regua.enviar === true && byId.A.regua.etapa === 1, `A (atraso 90, 0 tentativas) -> régua envia etapa 1 (${byId.A.regua.enviar}/${byId.A.regua.etapa})`);
ok(byId.B.balde === 'bloqueado' && byId.B.motivos.includes('sem_email'), `B -> bloqueado/sem_email (${byId.B.balde}/${byId.B.motivos})`);
ok(byId.C.balde === 'pronto' && byId.C.regua.enviar === false && byId.C.regua.motivo === 'aguardando', `C (atraso 31, elegível) -> pronto mas régua aguardando marco 33 (${byId.C.regua.enviar}/${byId.C.regua.motivo})`);

// para_hoje = quem é PRONTO/REVISAR e a régua manda enviar hoje (A sim; C não; B bloqueado)
ok(Array.isArray(leva.para_hoje) && leva.para_hoje.length === 1 && leva.para_hoje[0].unidade.id_unidade === 'A',
  `para_hoje = só A (${leva.para_hoje.map((u) => u.unidade.id_unidade)})`);

// totais úteis pro digest/painel
ok(leva.totais.prontos === 2 && leva.totais.bloqueados === 1 && leva.totais.para_hoje === 1,
  `totais: 2 prontos, 1 bloqueado, 1 para_hoje (${JSON.stringify(leva.totais)})`);

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(falhas ? 1 : 0);
