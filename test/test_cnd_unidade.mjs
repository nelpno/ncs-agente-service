// test_cnd_unidade.mjs — determinístico, sem LLM, sem API real.
// Regressão do bug "CND não bate com unidade" (Fernando 08/07): a CND saía com o
// id interno da unidade (id_unidade_uni, ex. 997) em vez do apartamento real
// (st_unidade_uni, ex. 12). O gerador agora resolve o nº REAL e NUNCA imprime o id interno.
import assert from 'node:assert';
import {
  getIdentificacaoUnidade,
  gerarDeclaracaoQuitacao,
} from '../gerador/src/declaracao-quitacao.mjs';

let ok = 0, total = 0;
const check = (cond, msg) => { total++; assert(cond, msg); ok++; };

// ---- Parte A: getIdentificacaoUnidade (lógica pura, sem Chrome/API) ----------

// resolve o rótulo real quando o getter acha a unidade
check(await getIdentificacaoUnidade(179, 997, async () => '12') === '12',
  'A1: deveria retornar o apartamento "12"');
check(await getIdentificacaoUnidade(179, 997, async () => '12 A') === '12 A',
  'A2: deveria retornar "12 A" (apto + bloco)');

// NUNCA inventa: getter que não acha (null) ou explode → retorna null (chamador decide fallback)
check(await getIdentificacaoUnidade(179, 997, async () => null) === null,
  'A3: não achou → null (não inventa apto)');
check(await getIdentificacaoUnidade(179, 997, async () => { throw new Error('SL 500'); }) === null,
  'A4: erro do Superlógica → null (não vaza id interno)');
check(await getIdentificacaoUnidade(179, 997, null) === null,
  'A5: sem getter → null');

// o id interno NUNCA aparece no retorno (o bug era "Unidade 997")
const nunca997 = await getIdentificacaoUnidade(179, 997, async () => null);
check(nunca997 == null || !String(nunca997).includes('997'),
  'A6: o retorno jamais contém o id interno 997');

// ---- Parte B: gerarDeclaracaoQuitacao — prioridade da unidade (DI, sem API) --
// A resolução autoritativa (Superlógica) VENCE inclusive um valor errado passado pelo chamador,
// e o dados.unidade jamais é o id interno.
const depsMock = {
  isGarantidora: () => false,
  getInadimplencia: async () => ({ status: 'sem_debito_vencido' }),
  getDadosCondominio: async () => ({ nome: 'CONDOMINIO TESTE', endereco: 'RUA X, 1', cidade_uf: 'Araraquara / SP' }),
  getIdentificacaoUnidade: async () => '12 A', // simula a resolução real do Superlógica
};
const r = await gerarDeclaracaoQuitacao(
  { id_condominio: 179, id_unidade: 997, identificacaoUnidade: 'VALOR ERRADO DO CHAMADOR', tipo: 'informativo' },
  depsMock
);
if (r.ok) {
  check(r.dados.unidade === '12 A', `B1: dados.unidade deveria ser "12 A", veio "${r.dados.unidade}"`);
  check(!String(r.dados.unidade).includes('997'), 'B2: dados.unidade não pode conter o id interno 997');
} else if (r.motivo === 'erro_pdf') {
  console.warn('  [B] pulado: render de PDF indisponível localmente (Chrome/Chromium) — lógica coberta pela Parte A');
} else {
  assert.fail(`B: gerarDeclaracaoQuitacao falhou inesperadamente: ${r.motivo} — ${r.detalhe}`);
}

console.log(`test_cnd_unidade: ${ok}/${total} OK`);
