// test_responsavel_cobranca.mjs — Onda 1: "quem recebe o boleto" no cadastro de inquilino.
// Decisão do Fernando (14/07): a IA PERGUNTA; default = o proprietário recebe.
//
// Os VALORES vêm do dado real, não da doc (a doc só lista 1/2/4 e omite o 7).
// Medido em 25 condomínios / 3.330 responsáveis ativos (.tmp/superlogica_tiporesp_*.mjs):
//   · inquilino NÃO responsável → ID_TIPORESP_TRES=4  (+ proprietário fica em 1) — 416/416 unidades
//   · inquilino É   responsável → ID_TIPORESP_TRES=7  (+ proprietário vira 2)    — 140/140 unidades
//   · inquilino com valor 1: 0 de 872. Nunca. Escrever 1 inventaria um estado inexistente.
//   · 0 unidades com inquilino=7 E proprietário=1 → o flip do proprietário é OBRIGATÓRIO,
//     senão os dois recebem a taxa normal (a duplicação que o Fernando quis evitar).
import { cadastroInquilino } from '../src/write/actions/cadastro_inquilino.mjs';
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };
const TR = 'contatos[0][ID_TIPORESP_TRES]';
const base = { id_condominio: '179', id_unidade: '900', nome: 'João Silva', papel: 'inquilino', data_entrada: '06/30/2026', cpf: '12345678901' };

// --- valor gravado em ID_TIPORESP_TRES
ok(cadastroInquilino.montarPayload(base)[TR] === '4',
  'sem responsavel_cobranca → 4 (default: quem recebe é o proprietário)');
ok(cadastroInquilino.montarPayload({ ...base, responsavel_cobranca: 'proprietario' })[TR] === '4',
  'responsavel_cobranca=proprietario → 4');
ok(cadastroInquilino.montarPayload({ ...base, responsavel_cobranca: 'inquilino' })[TR] === '7',
  'responsavel_cobranca=inquilino → 7 (valor real da base; NUNCA 1)');
ok(cadastroInquilino.montarPayload({ ...base, papel: 'dependente' })[TR] === '4',
  'dependente → 4 (dependente nunca recebe: 141/141 no dado real)');

// --- validação
ok(cadastroInquilino.validar({ ...base, responsavel_cobranca: 'inquilino' }).ok === true,
  'responsavel_cobranca=inquilino é válido p/ papel inquilino');
ok(cadastroInquilino.validar({ ...base, responsavel_cobranca: 'proprietario' }).ok === true,
  'responsavel_cobranca=proprietario é válido');
ok(cadastroInquilino.validar({ ...base, responsavel_cobranca: 'sindico' }).ok === false,
  'responsavel_cobranca com valor fora do enum → inválido');
ok(cadastroInquilino.validar({ ...base, papel: 'dependente', responsavel_cobranca: 'inquilino' }).ok === false,
  'dependente NÃO pode ser o responsável pela cobrança → inválido');
ok(cadastroInquilino.validar(base).ok === true,
  'responsavel_cobranca é opcional (não quebra quem não informa)');

// --- o painel de aprovação precisa DIZER o que muda (nada falha calado)
const rInq = cadastroInquilino.render({ ...base, responsavel_cobranca: 'inquilino' }, []);
const txtInq = JSON.stringify(rInq);
ok(/respons[aá]vel/i.test(txtInq) && /inquilino/i.test(txtInq),
  'render: mostra que o inquilino é o responsável pela cobrança');
ok(rInq.alertas?.some((a) => /propriet[aá]rio/i.test(a) && /extra/i.test(a)),
  'render: alerta que o proprietário precisa virar "só extras" (senão duplica o boleto)');

const rProp = cadastroInquilino.render(base, []);
ok(!(rProp.alertas || []).some((a) => /propriet[aá]rio/i.test(a) && /extra/i.test(a)),
  'render: caso padrão NÃO alerta flip (controle — o alerta não é decorativo)');

// --- resumo: a frase que o aprovador lê em 5 segundos (hoje o card do Portal despeja chave crua)
ok(typeof rProp.resumo === 'string' && rProp.resumo.length > 0, 'render: devolve um resumo em texto');
ok(/João Silva/.test(rProp.resumo) && /900/.test(rProp.resumo), 'resumo: diz QUEM entra e em QUAL unidade');
ok(/propriet[aá]rio/i.test(rProp.resumo), 'resumo: diz quem recebe o boleto (padrão = proprietário)');
ok(/inquilino/i.test(rInq.resumo) && /boleto/i.test(rInq.resumo), 'resumo: no caso do inquilino responsável, diz que o boleto vai p/ ele');
ok(!/undefined|\[object/.test(rProp.resumo + rInq.resumo), 'resumo: sem undefined/[object Object] vazando');

// --- rótulo da unidade e data: quem lê o card é HUMANO, não quem tem acesso ao banco.
// O Fernando já reportou esse bug uma vez (a CND saía com "unidade 997" = o id interno).
// Pior no alerta: mandar "mude a unidade 14381" é instrução que o aprovador NÃO consegue executar,
// porque no Superlógica a unidade se chama "QUADRA 20 / LOTE 0314".
// O rótulo vem do ERP (resolver_cadastro.unidades[].identificacao), nunca do LLM.
const comLabel = { ...base, unidade_label: 'QUADRA 20 / LOTE 0314' };
const rl = cadastroInquilino.render(comLabel, []);
ok(/QUADRA 20 \/ LOTE 0314/.test(rl.resumo), 'resumo usa o rótulo da unidade, não o id interno');
ok(!/\b900\b/.test(rl.resumo), 'resumo NÃO mostra o id interno quando há rótulo');
ok(/QUADRA 20 \/ LOTE 0314/.test(cadastroInquilino.render({ ...comLabel, responsavel_cobranca: 'inquilino' }, []).alertas[0]),
  'alerta do flip cita a unidade que o aprovador acha no Superlógica (senão não dá p/ executar)');
ok(/900/.test(rProp.resumo), 'sem rótulo → cai no id (compat, não quebra)');

// data: MM/DD/AAAA é o que a API do Superlógica exige, mas ninguém lê "06/30/2026" em português
ok(/30\/06\/2026/.test(rl.resumo), 'resumo mostra a data em DD/MM/AAAA');
ok(cadastroInquilino.montarPayload(comLabel)['contatos[0][DT_ENTRADA_RES]'] === '06/30/2026',
  'payload PRESERVA MM/DD/AAAA (a API exige) — a troca é só de exibição');
ok(!JSON.stringify(cadastroInquilino.montarPayload(comLabel)).includes('QUADRA 20'),
  'unidade_label não vaza pro payload da API');

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
