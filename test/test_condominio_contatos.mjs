// test_condominio_contatos.mjs — resolverContatos: agnóstico à fonte (Supabase quando sbEnabled, senão JSON).
import { resolverContatos, _reload } from '../src/condominio_contatos.mjs';

let ok = 0, fail = 0;
const check = (n, c) => { if (c) ok++; else { fail++; console.log(`  ❌ ${n}`); } };

// 1) slug vazio/nulo → null, sem nem tentar resolver
let chamouSb = false;
const r1 = await resolverContatos(null, { sbEnabled: () => { chamouSb = true; return true; } });
check('slug nulo → null sem chamar sbEnabled', r1 === null && chamouSb === false);

// 2) sbEnabled=false → cai no JSON real de produção (hoje vazio) → null pra qualquer slug desconhecido
_reload();
const r2 = await resolverContatos('condominio-inexistente-xyz', { sbEnabled: () => false });
check('JSON de produção → null pra slug desconhecido', r2 === null);

// 3) sbEnabled=false + jsonData injetado → resolve do objeto injetado (sem tocar o arquivo real)
const jsonFake = { lume: { sindico_whatsapp: '5516999990000', portaria_grupo_jid: '123@g.us', sindico_nome: 'Fulano' } };
const r3 = await resolverContatos('lume', { sbEnabled: () => false, jsonData: jsonFake });
check('jsonData injetado → resolve o slug', r3?.sindico_whatsapp === '5516999990000' && r3?.portaria_grupo_jid === '123@g.us');
check('campo presente no objeto injetado é preservado (sindico_nome)', r3?.sindico_nome === 'Fulano');
check('campos ausentes no objeto injetado viram null (não undefined)', r3.portaria_email === null && r3.pessoa_whatsapp === null);

const r3b = await resolverContatos('condo-nao-cadastrado', { sbEnabled: () => false, jsonData: jsonFake });
check('slug fora do jsonData → null', r3b === null);

// 4) sbEnabled=true → chama sbSelect (fake), normaliza a 1ª linha
const rowsFake = [{ condominio_id: 'lume', sindico_whatsapp: '5516988887777', portaria_grupo_jid: null, portaria_email: 'p@x.com', sindico_nome: 'Ciclano', pessoa_nome: null, pessoa_whatsapp: null, pessoa_email: null, campo_extra_ignorado: 'x' }];
const r4 = await resolverContatos('lume', {
  sbEnabled: () => true,
  sbSelect: async (table, query) => { check('sbSelect chamado com a tabela certa', table === 'condominio_contatos'); check('sbSelect filtra por condominio_id=eq.<slug>', query.includes('condominio_id=eq.lume')); return rowsFake; },
});
check('Supabase → resolve e normaliza (sem campo extra)', r4?.sindico_whatsapp === '5516988887777' && !('campo_extra_ignorado' in r4) && !('condominio_id' in r4));

// 5) sbEnabled=true, sem linha (array vazio) → null (não é erro, é gap de dado)
const r5 = await resolverContatos('condo-sem-contato', { sbEnabled: () => true, sbSelect: async () => [] });
check('Supabase sem linha → null', r5 === null);

// 6) sbEnabled=true, sbSelect lança → cai pro JSON local (nunca lança pro chamador)
const r6 = await resolverContatos('lume', {
  sbEnabled: () => true,
  sbSelect: async () => { throw new Error('timeout simulado'); },
  jsonData: jsonFake,
});
check('Supabase falha → cai pro JSON injetado, sem lançar', r6?.sindico_whatsapp === '5516999990000');

console.log(`\n${fail === 0 ? '✅' : '❌'} condominio_contatos: ${ok} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
