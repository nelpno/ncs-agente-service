// test_condominio_nao_localizado.mjs — a pessoa erra o NOME do condomínio e a Ana NÃO pode
// responder com a unidade de outro prédio.
//
// POR QUE ISTO EXISTE (caso real, conversa 830 de 10/08/2026): a moradora pediu a 2ª via, informou
// "Apt 403 bloco 4" e escreveu o condomínio como "Spazzio aboccato" (dois Z, um C a menos). O
// `_filtrarCondos` não casou nenhum dos 59 — e, como ele é um FILTRO que devolve a lista INTEIRA
// quando nada casa, a varredura rodou nos 59 condomínios e a Ana respondeu:
//
//     "Encontrei mais de uma unidade 403 ... Achei estas opções no condomínio Vale Supremo:
//      BL 01 / APTO 403 ... BL 09 / APTO 403"
//
// A moradora respondeu "Bloco 4" e a Ana entregou os canais da garantidora ASSISCON — que é a
// garantidora do VALE SUPREMO, um condomínio que a moradora nunca citou. Ou seja: um erro de
// digitação virou informação acionável sobre outro prédio, e quem desfez foi o atendente humano.
//
// A regra: quando a pessoa NOMEIA um condomínio e ele não é localizado, um match fraco (só a
// unidade bate) não vale — o condomínio é a única âncora que impede pegar o apartamento de outro
// prédio, e "403" existe em dezenas deles. CPF/telefone continuam varrendo tudo de propósito
// (207 CPFs da base têm unidade em 2+ condomínios — ver test_resolver_multi_condo.mjs).
//
// Uso: node test/test_condominio_nao_localizado.mjs

import { resolver_cadastro, _filtrarCondos } from '../src/superlogica.mjs';

let failures = 0;
function assert(condition, label) {
  if (condition) console.log('  OK  ', label);
  else { console.error('  FAIL', label); failures++; }
}

// Fixture com os nomes REAIS envolvidos no caso (sem PII).
const CONDOS = [
  { id: 176, nome: 'SPAZIO ABBOCATO' },
  { id: 186, nome: 'CONDOMINIO VALE SUPREMO' },
  { id: 181, nome: 'RESERVA DO CAMPO' },
  { id: 172, nome: 'CONDOMINIO EDIFICIO ROSA DE OURO' },
];
// A unidade 403 existe nos dois prédios — é isso que torna o erro de digitação perigoso.
const PORTAS = {
  176: [{ id_unidade_uni: '5001', st_bloco_uni: 'TORRE 04', st_unidade_uni: '403', st_nome_con: 'CAROLINA MENDES', st_cpf_con: '047.541.092-01', id_label_tres: '1' }],
  186: Array.from({ length: 9 }, (_, i) => ({
    id_unidade_uni: `6${String(i).padStart(3, '0')}`, st_bloco_uni: `BL 0${i + 1}`, st_unidade_uni: '403',
    st_nome_con: `MORADOR ${i}`, st_cpf_con: `999.888.777-0${i}`, id_label_tres: '1',
  })),
  181: [{ id_unidade_uni: '7001', st_bloco_uni: '', st_unidade_uni: '403', st_nome_con: 'OUTRA PESSOA', st_cpf_con: '555.444.333-22', id_label_tres: '1' }],
};
const deps = () => ({
  listCondominios: async () => CONDOS,
  slGet: async (_ca, p) => PORTAS[p.idCondominio] || [],
});

console.log('\n=== test_condominio_nao_localizado.mjs ===\n');

// 1. O caso real: nome errado + unidade que existe em vários prédios.
{
  const r = await resolver_cadastro({ condominio: 'Spazzio aboccato', unidade: 'Apt 403 bloco 4' }, deps());
  assert(r.encontrado === false, 'nome de condomínio não localizado → NÃO encontra');
  assert(r.motivo === 'condominio_nao_localizado', `motivo condominio_nao_localizado (veio "${r.motivo}")`);
  assert(r.condominio_informado === 'Spazzio aboccato', 'devolve o nome que a pessoa escreveu, para a Ana repetir na pergunta');
  const nomes = JSON.stringify(r.unidades || []);
  assert(!/VALE SUPREMO/.test(nomes), 'NÃO devolve nenhuma unidade do Vale Supremo');
  assert((r.unidades || []).length === 0, 'não devolve unidade alguma');
}

// 2. Com CPF, a varredura global continua valendo (o CPF é âncora própria; multi-condo é real).
{
  const r = await resolver_cadastro({ cpf: '047.541.092-01', condominio: 'Spazzio aboccato' }, deps());
  assert(r.encontrado === true, 'CPF válido + nome errado do condomínio → ainda identifica');
  assert(r.criterio === 'cpf', `critério cpf (veio "${r.criterio}")`);
  assert(r.unidades?.[0]?.condominio === 'SPAZIO ABBOCATO', 'e identifica o condomínio CERTO, pelo CPF');
}

// 3. CONTROLE NEGATIVO — o nome escrito certo continua funcionando exatamente como antes.
{
  const r = await resolver_cadastro({ condominio: 'Spazio Abbocato', unidade: 'Apt 403', nome: 'Carolina Mendes' }, deps());
  assert(r.encontrado === true, 'nome certo + unidade + nome da pessoa → encontra');
  assert(r.unidades?.length === 1 && r.unidades[0].condominio === 'SPAZIO ABBOCATO', 'e só no condomínio dela');
}

// 4. CONTROLE — sem condomínio informado o contrato antigo não muda (segue exigindo o condomínio).
{
  const r = await resolver_cadastro({ unidade: '403' }, deps());
  assert(r.motivo === 'nome_exige_condominio', `sem condomínio → nome_exige_condominio (veio "${r.motivo}")`);
}

// 5. CONTROLE — condomínio localizado mas sem a unidade: NÃO pode virar "não localizei o condomínio"
//    (a pessoa erraria o prédio achando que errou o nome).
{
  const r = await resolver_cadastro({ condominio: 'Reserva do Campo', unidade: '999' }, deps());
  assert(r.encontrado === false, 'condomínio certo, unidade inexistente → não encontra');
  assert(r.motivo === 'unidade_nao_encontrado', `motivo é da UNIDADE, não do condomínio (veio "${r.motivo}")`);
}

// 6. AUTOTESTE DO DETECTOR — a condição usada no fix ("o filtro não reduziu nada") tem de ser
//    verdadeira no nome errado e FALSA no nome certo. Sem isto, um filtro que passasse a devolver
//    lista cheia em todo caso transformaria o guard num "nunca acha nada", e os testes acima
//    continuariam verdes pelo motivo errado.
{
  assert(_filtrarCondos(CONDOS, 'Spazzio aboccato').length === CONDOS.length, 'detector: nome errado não reduz a lista');
  assert(_filtrarCondos(CONDOS, 'Spazio Abbocato').length < CONDOS.length, 'detector: nome certo REDUZ a lista');
}

console.log(failures === 0 ? '\n✅ todos passaram\n' : `\n❌ ${failures} falha(s)\n`);
process.exit(failures === 0 ? 0 : 1);
