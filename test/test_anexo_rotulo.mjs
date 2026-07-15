// test_anexo_rotulo.mjs — o anexo do boleto carrega a IDENTIFICAÇÃO da unidade.
//
// POR QUÊ: com 2 boletos na mesma conversa ("de ambos"), cada PDF precisa dizer de qual unidade
// é — senão chegam dois "boleto.pdf" e o morador não sabe qual é qual. O rótulo sai do
// ctx.unidades (mapa do ERP, ancorado na sessão) e NUNCA do LLM: é o que impede trocar a
// etiqueta de um boleto pelo outro. Ver .tmp/test_legenda_anexo.mjs (o outro lado, no adapter).
// Uso: node test/test_anexo_rotulo.mjs

import { runToolReal } from '../src/agent.mjs';

let failures = 0;
function assert(c, label) { if (c) console.log('  OK  ', label); else { console.error('  FAIL', label); failures++; } }

console.log('\n=== test_anexo_rotulo.mjs ===\n');

// Stub do módulo do Superlógica via ctx: runToolReal chama SL.get_boleto_pdf_url de verdade,
// então testamos o CONTRATO do ctx.attachments montando o caso pelo caminho de canal externo.
// (sem chatId = canal externo → o anexo é registrado em ctx.attachments p/ o adapter entregar)
const { _pushAnexo } = await import('../src/agent.mjs');

if (typeof _pushAnexo !== 'function') {
  console.error('  FAIL _pushAnexo não exportado (o teste precisa do ponto de montagem do anexo)');
  process.exit(1);
}

// 1. Com o rótulo do ERP na sessão → o anexo carrega a identificação
{
  const ctx = { unidades: { '16537': 'Quadra 08 / Lote 20' } };
  _pushAnexo(ctx, { pdf_url: 'https://x/b.pdf', filename: 'boleto-1.pdf', vencimento: '06/10/2026', valor: '589,00' }, '16537');
  const a = ctx.attachments[0];
  assert(a.unidade === 'Quadra 08 / Lote 20', 'anexo leva a identificação da unidade (do ERP)');
  assert(a.vencimento === '06/10/2026', 'anexo leva o vencimento');
  assert(a.url === 'https://x/b.pdf' && a.kind === 'pdf', 'url/kind preservados (contrato atual)');
}

// 2. Dois boletos → identificações DIFERENTES (o morador distingue)
{
  const ctx = { unidades: { '16537': 'Quadra 08 / Lote 20', '16538': 'Quadra 08 / Lote 21' } };
  _pushAnexo(ctx, { pdf_url: 'u1', filename: 'b1.pdf', vencimento: '06/10/2026' }, '16537');
  _pushAnexo(ctx, { pdf_url: 'u2', filename: 'b2.pdf', vencimento: '06/10/2026' }, '16538');
  assert(ctx.attachments.length === 2, 'dois anexos na mesma resposta');
  assert(ctx.attachments[0].unidade !== ctx.attachments[1].unidade, 'cada anexo tem a SUA unidade');
  assert(ctx.attachments[1].unidade === 'Quadra 08 / Lote 21', '  (o 2º é o Lote 21)');
}

// 3. Unidade desconhecida → null, nunca inventa nem quebra
{
  const ctx = {};
  _pushAnexo(ctx, { pdf_url: 'u', filename: 'b.pdf' }, '99999');
  assert(ctx.attachments[0].unidade === null, 'sem rótulo no ERP → null (não inventa)');
}

console.log('\n' + (failures === 0 ? '✓ Todos os testes passaram.' : `✗ ${failures} teste(s) FALHARAM.`) + '\n');
process.exit(failures > 0 ? 1 : 0);
