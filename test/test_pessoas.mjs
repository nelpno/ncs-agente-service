// test_pessoas.mjs — índice global de CPF (tabela `pessoas`) + integração no resolver_cadastro.
// Fixtures puras (sem API, sem Supabase, sem PII). Uso: node test/test_pessoas.mjs
import { buscarPorCpf } from '../src/pessoas.mjs';
import { resolver_cadastro } from '../src/superlogica.mjs';

let failures = 0;
function assert(cond, label) { if (cond) console.log('  OK  ', label); else { console.error('  FAIL', label); failures++; } }

const linha = (o) => ({ id_condominio: 100, condominio: 'CONDO A', id_unidade: 900, unidade: 'APTO 42', bloco: '', nome: 'MARIA SILVA', papel: 'Proprietário', id_label: 1, ativo: true, dt_saida: null, ...o });
const DUAS = [linha({}), linha({ id_condominio: 150, condominio: 'CONDO B', id_unidade: 901, unidade: 'LOTE 20', bloco: 'QUADRA 8' })];

// ── buscarPorCpf (unitário) ──────────────────────────────────────────────────────────────────
console.log('# buscarPorCpf');
{
  const r = await buscarPorCpf('11122233344', {}, { sbEnabled: () => true, sbSelect: async () => DUAS });
  assert(r && r.encontrado && r.criterio === 'cpf' && r.confianca === 'alta', 'hit: encontrado/cpf/alta');
  assert(r.unidades.length === 2, 'hit multi-condo: 2 unidades (mata o ponto cego)');
  const u = r.unidades[0];
  assert(u.id_unidade === 900 && u.condominio === 'CONDO A' && u.identificacao === 'APTO 42', 'shape: id_unidade/condominio/identificacao');
  assert(u.papel === 1 && u.papel_nome === 'Proprietário' && u.nome === 'MARIA SILVA', 'shape: papel/papel_nome/nome');
  assert(r.unidades[1].identificacao === 'QUADRA 8 / LOTE 20', 'identificacao com bloco');
}
{
  const r = await buscarPorCpf('00000000000', {}, { sbEnabled: () => true, sbSelect: async () => [] });
  assert(r === null, 'miss (vazio) → null (cai na varredura)');
}
{
  let chamou = false;
  const r = await buscarPorCpf('11122233344', {}, { sbEnabled: () => false, sbSelect: async () => { chamou = true; return DUAS; } });
  assert(r === null && !chamou, 'Supabase off → null, nem consulta');
}
{
  const r = await buscarPorCpf('11122233344', {}, { sbEnabled: () => true, sbSelect: async () => { throw new Error('rede'); } });
  assert(r === null, 'erro de rede → null (fallback)');
}
{
  const r = await buscarPorCpf('11122233344', { condominio: 'CONDO B' }, { sbEnabled: () => true, sbSelect: async () => DUAS });
  assert(r && r.unidades.length === 1 && r.unidades[0].condominio === 'CONDO B', 'condominio informado filtra');
  const miss = await buscarPorCpf('11122233344', { condominio: 'CONDO Z' }, { sbEnabled: () => true, sbSelect: async () => DUAS });
  assert(miss === null, 'condominio informado sem match no índice → null (varredura ao vivo)');
}
{
  const dup = [linha({}), linha({})];
  const r = await buscarPorCpf('11122233344', {}, { sbEnabled: () => true, sbSelect: async () => dup });
  assert(r.unidades.length === 1, 'dedup por condo:unidade');
  const ex = await buscarPorCpf('11122233344', {}, { sbEnabled: () => true, sbSelect: async () => [linha({ ativo: false, dt_saida: '01/01/2020' })] });
  assert(ex.unidades[0].ex_morador === true, 'ativo=false → ex_morador');
}

// ── integração no resolver_cadastro ──────────────────────────────────────────────────────────
console.log('# resolver_cadastro (índice-primeiro só no CPF)');
{
  let varreu = false;
  const deps = {
    sbEnabled: () => true, sbSelect: async (t, q) => { assert(t === 'pessoas' && /doc=eq\.11122233344/.test(q), 'query pessoas por doc'); return DUAS; },
    listCondominios: async () => { varreu = true; return []; },
    slGet: async () => { varreu = true; return []; },
  };
  const r = await resolver_cadastro({ cpf: '111.222.333-44' }, deps);
  assert(r.encontrado && r.unidades.length === 2 && r._fonte === 'indice', 'CPF hit → índice (2 unidades)');
  assert(!varreu, 'CPF hit → varredura de 59 condos NÃO roda');
}
{
  let slGetCalled = false;
  const deps = {
    sbEnabled: () => true, sbSelect: async () => [], // miss
    listCondominios: async () => [{ id: 100, nome: 'CONDO A' }],
    slGet: async () => { slGetCalled = true; return [{ st_cpf_con: '11122233344', id_unidade_uni: '900', st_unidade_uni: 'APTO 1', st_bloco_uni: '', st_nome_con: 'MARIA', id_label_tres: '1' }]; },
  };
  const r = await resolver_cadastro({ cpf: '111.222.333-44' }, deps);
  assert(slGetCalled, 'CPF miss no índice → varredura assume');
  assert(r.encontrado && r.criterio === 'cpf', 'miss → varredura acha por CPF');
}
{
  let slGetCalled = false; // sem sbEnabled injetado → default lê config.supabaseUrl ('' no teste) = off → varredura
  const deps = {
    listCondominios: async () => [{ id: 100, nome: 'CONDO A' }],
    slGet: async () => { slGetCalled = true; return [{ st_cpf_con: '11122233344', id_unidade_uni: '900', st_unidade_uni: 'APTO 1', st_bloco_uni: '', st_nome_con: 'MARIA', id_label_tres: '1' }]; },
  };
  const r = await resolver_cadastro({ cpf: '111.222.333-44' }, deps);
  assert(slGetCalled && r.encontrado, 'Supabase ausente (CI) → varredura, comportamento de sempre');
}

console.log(failures ? `\nFALHOU: ${failures}` : '\nTUDO VERDE');
process.exit(failures ? 1 : 0);
