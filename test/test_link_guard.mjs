/**
 * test_link_guard.mjs — determinístico, sem API/LLM.
 *
 * Caso real (27/07/2026, conv 257): a Ana enviou `gruponcs.net/ticket-mudanca` — slug que NÃO
 * existe (o correto é `autorizacao-de-mudanca`, usado corretamente nas outras ~15 vezes do dia).
 * O prompt já proibia compor URL e o gate já tinha o detector; escapou mesmo assim, 1 em ~50.
 * Este guard é a rede determinística: link fora da allowlist não chega ao morador.
 *
 * Rodar: node test/test_link_guard.mjs
 */
import { sanitizarLinks, carregarSlugs } from '../src/link_guard.mjs';

let ok = 0, fail = 0;
const t = (nome, cond) => { if (cond) { ok++; console.log('  ✓', nome); } else { fail++; console.log('  ✗', nome); } };

// Allowlist fixa (fixture) — o teste não pode depender do conteúdo atual da base.
const ALLOW = new Set([
  'autorizacao-de-mudanca',
  'ticket-cadastro-inquilino',
  'ticket-cadastrar-dependente',
  'ticket-compra-e-venda',
  'abertura-chamado-condominos',
  'imobiliaria-atendimento-via-ticket',
]);

console.log('\n=== 1. O caso real da conv 257 ===');
{
  const reply = 'Boa tarde!\nPara programar a mudança, use este formulário:\nhttps://gruponcs.net/ticket-mudanca\nPeço que faça com 72 horas de antecedência.';
  const r = sanitizarLinks(reply, ALLOW);
  t('detecta o slug inventado', r.removidos.includes('ticket-mudanca'));
  t('a URL inventada NÃO sai na resposta', !/ticket-mudanca/.test(r.texto));
  t('o resto da mensagem é preservado', /72 horas de antecedência/.test(r.texto));
  t('avisa que não confirmou o link', /não consegui confirmar o link/i.test(r.texto));
}

console.log('\n=== 2. Link legítimo NUNCA é removido (falso positivo quebraria atendimento) ===');
{
  const reply = 'Para agendar, preencha este formulário:\nhttps://gruponcs.net/autorizacao-de-mudanca\nA mudança não tem taxa.';
  const r = sanitizarLinks(reply, ALLOW);
  t('nada removido', r.removidos.length === 0);
  t('texto sai idêntico', r.texto === reply);
}
{
  const reply = 'Se for inquilino: https://gruponcs.net/ticket-cadastro-inquilino\nSe for dependente: https://gruponcs.net/ticket-cadastrar-dependente';
  const r = sanitizarLinks(reply, ALLOW);
  t('dois links válidos passam', r.removidos.length === 0 && r.texto === reply);
}

console.log('\n=== 3. Mistura: mantém o bom, remove o inventado ===');
{
  const reply = 'Cadastro: https://gruponcs.net/ticket-cadastro-inquilino\nMudança: https://gruponcs.net/ticket-mudanca';
  const r = sanitizarLinks(reply, ALLOW);
  t('remove só o inventado', r.removidos.length === 1 && r.removidos[0] === 'ticket-mudanca');
  t('mantém o link válido', /ticket-cadastro-inquilino/.test(r.texto));
  t('sem o link inválido', !/ticket-mudanca/.test(r.texto));
}

console.log('\n=== 4. Robustez ===');
t('reply vazio não quebra', sanitizarLinks('', ALLOW).texto === '');
t('reply null não quebra', sanitizarLinks(null, ALLOW).texto === '');
t('texto sem link passa intacto', sanitizarLinks('Bom dia! Como posso ajudar?', ALLOW).texto === 'Bom dia! Como posso ajudar?');
t('allowlist VAZIA desliga o guard (nunca derruba link bom)', sanitizarLinks('veja https://gruponcs.net/qualquer-coisa', new Set()).removidos.length === 0);
t('outro domínio não é tocado', sanitizarLinks('https://admgrupo.superlogica.net/clients/x-FaturaHtml', ALLOW).removidos.length === 0);
t('link do YouTube (vídeo do Gruvi) não é tocado', sanitizarLinks('https://youtu.be/Uw5ySR1cUo0', ALLOW).removidos.length === 0);
{
  const r = sanitizarLinks('Use https://gruponcs.net/slug-fake agora mesmo.', ALLOW);
  t('URL no MEIO da frase também é removida', !/slug-fake/.test(r.texto));
}

console.log('\n=== 5. carregarSlugs lê a base real ===');
{
  const reais = carregarSlugs();
  t('a base tem slugs carregados', reais.size > 0);
  t('inclui o formulário de mudança oficial', reais.has('autorizacao-de-mudanca'));
  t('NÃO inclui o slug inventado da conv 257', !reais.has('ticket-mudanca'));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${ok} passaram, ${fail} falharam\n`);
process.exit(fail === 0 ? 0 : 1);
