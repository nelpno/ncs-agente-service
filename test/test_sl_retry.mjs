// test_sl_retry.mjs — o Superlógica bloqueia por excesso de chamadas (HTTP 429) e isso NÃO é motivo
// para largar o atendimento com um humano.
//
// Aconteceu ao vivo no teste dos 20 (07/08/2026), com o Fernando assistindo: a identificação varre
// até 30 condomínios em paralelo, o ERP recusou, e a Ana — que degradou certo, avisou e passou para
// a equipe — não tentou de novo. Fernando, na hora: "ele recusou o acesso por causa do excesso de
// chamadas". É falha momentânea; uma segunda tentativa 1 segundo depois resolve.
//
// ⚠️ O retry vale SÓ para leitura. Repetir uma ESCRITA no ERP cadastraria a pessoa duas vezes —
// por isso este teste também prova que o caminho de escrita não ganhou retry nenhum.
process.env.SL_RETRY_BASE_MS = '5'; // o teste não espera de verdade; a regra é a mesma
const { responsaveisIndex } = await import('../src/superlogica.mjs');
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

const original = globalThis.fetch;
const resp = (status, body = []) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body });
function fakeFetch(sequencia) {
  const chamadas = [];
  globalThis.fetch = async (url) => { chamadas.push(String(url)); return sequencia[Math.min(chamadas.length - 1, sequencia.length - 1)]; };
  return chamadas;
}

// ── 429 seguido de sucesso: o dado chega, sem ninguém ser incomodado ───────────────────────────────
{
  const chamadas = fakeFetch([resp(429), resp(200, [{ st_nome_con: 'Fulano', id_unidade_uni: '900' }])]);
  const r = await responsaveisIndex('172');
  ok(Array.isArray(r) && r.length === 1, '429 na 1ª e 200 na 2ª → devolve o dado (não vira erro)');
  ok(chamadas.length === 2, `tentou de novo exatamente 1 vez (foram ${chamadas.length} chamadas)`);
}

// ── 5xx é a mesma família: transitório ─────────────────────────────────────────────────────────────
{
  const chamadas = fakeFetch([resp(503), resp(200, [{ st_nome_con: 'Beltrano' }])]);
  const r = await responsaveisIndex('172');
  ok(r.length === 1 && chamadas.length === 2, '503 → tenta de novo e entrega');
}

// ── 429 sempre: desiste e ERRA ALTO (não devolve lista vazia, que viraria "não achei ninguém") ─────
{
  const chamadas = fakeFetch([resp(429)]);
  let lancou = false;
  try { await responsaveisIndex('172'); } catch { lancou = true; }
  ok(lancou, '429 em todas → lança (lista vazia seria pior: "essa unidade não tem morador")');
  ok(chamadas.length === 3, `desiste depois de 3 tentativas no total (foram ${chamadas.length})`);
}

// ── 4xx que NÃO é 429 não se repete: 403/404 não melhoram por insistência ─────────────────────────
{
  const chamadas = fakeFetch([resp(403)]);
  try { await responsaveisIndex('172'); } catch { /* esperado */ }
  ok(chamadas.length === 1, `403 → uma tentativa só (foram ${chamadas.length})`);
}
{
  const chamadas = fakeFetch([resp(404)]);
  try { await responsaveisIndex('172'); } catch { /* esperado */ }
  ok(chamadas.length === 1, '404 → uma tentativa só');
}

// ── 🔴 ESCRITA NÃO REPETE ──────────────────────────────────────────────────────────────────────────
// Um PUT repetido cadastra a pessoa duas vezes na unidade. O módulo de escrita é outro, de propósito;
// este teste falha se alguém "melhorar" o slPut aplicando a mesma ideia.
{
  const fonte = (await import('node:fs')).readFileSync(new URL('../src/superlogica_write.mjs', import.meta.url), 'utf8');
  ok(!/SL_RETRY|tentativas|retry/i.test(fonte), 'superlogica_write.mjs continua SEM retry (escrita repetida = cadastro duplicado)');
}

globalThis.fetch = original;
console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
