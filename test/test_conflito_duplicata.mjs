// test_conflito_duplicata.mjs — a Ana não pode cadastrar DUAS VEZES a mesma pessoa na unidade.
//
// O bug real (achado em 16/07, com o dado de produção da unidade 4457/Allure):
//   · `checarConflito` lia `c.st_cpfcnpj_con`, mas `responsaveis/index` devolve **`st_cpf_con`** →
//     campo inexistente → comparação por CPF SEMPRE falsa, calada.
//   · a busca por NOME só rodava quando NÃO havia CPF (`!d.cpf`). Quando o CPF virou obrigatório
//     (0103794, 15/07), essa condição virou sempre-falsa → a detecção de duplicata MORREU INTEIRA.
//   · medido: Bruno Muller JÁ cadastrado na unidade, e nem o CPF certo nem o nome o achavam →
//     o PUT criaria um segundo "Bruno Muller de Souza" com CPF errado, sem avisar ninguém.
//
// Por isso as fixtures aqui usam os nomes de campo EXATOS da API (st_cpf_con), copiados do snapshot
// real: fixture com campo inventado deixa o teste verde e o bug vivo — foi o que aconteceu.
import assert from 'node:assert';
import { cadastroInquilino } from '../src/write/actions/cadastro_inquilino.mjs';

let ok = 0;
const t = async (nome, fn) => { try { await fn(); console.log(`  ok  ${nome}`); ok++; } catch (e) { console.error(`  FALHOU  ${nome}\n      ${e.message}`); process.exitCode = 1; } };

// Unidade 4457 (Allure, BL 11 / 0401) como a API devolve de verdade.
const UNIDADE = [
  { st_nome_con: 'ROSA MARIA CITTA PAVAN', st_cpf_con: '86473140859', id_label_tres: '1', id_contato_con: '53230' },
  { st_nome_con: 'BRUNO MULLER DE SOUZA', st_cpf_con: '41499029845', id_label_tres: '7', id_contato_con: '70487' },
];
const io = { responsaveisIndex: async () => UNIDADE };
const base = { id_condominio: '62', id_unidade: '4457' };
const conflito = (d) => cadastroInquilino.checarConflito({}, { ...base, ...d }, io);

console.log('\n[1] a mesma pessoa não entra duas vezes');

await t('CPF idêntico ao cadastrado → conflito', async () => {
  const r = await conflito({ nome: 'Bruno Muller de Souza', cpf: '41499029845' });
  assert.equal(r.conflito, true, 'não achou a pessoa pelo CPF exato dela (campo st_cpf_con)');
});

await t('CPF com pontuação → conflito (compara só dígitos)', async () => {
  const r = await conflito({ nome: 'Bruno Muller de Souza', cpf: '414.990.298-45' });
  assert.equal(r.conflito, true, 'a máscara do CPF quebrou a comparação');
});

await t('mesmo NOME com CPF diferente → conflito (o caso do ensaio de 16/07)', async () => {
  // O cadastro pode ter CPF vazio/velho; quem chega pelo nome é a mesma pessoa. Pende p/ o humano.
  const r = await conflito({ nome: 'Bruno Muller de Souza', cpf: '11144477735' });
  assert.equal(r.conflito, true, 'com CPF novo, o nome deixou de ser comparado → duplicata silenciosa');
});

await t('nome com acento/caixa diferente → conflito (normaliza)', async () => {
  const r = await conflito({ nome: 'bruno müller de souza', cpf: '11144477735' });
  assert.equal(r.conflito, true, 'a normalização de nome não pegou');
});

await t('sem CPF → conflito pelo nome (fluxo antigo não regride)', async () => {
  const r = await conflito({ nome: 'Bruno Muller de Souza' });
  assert.equal(r.conflito, true);
});

console.log('\n[1b] o ERP grava espaço a mais no meio do nome — ninguém digita assim');

// Achado no stress de 08/08 (cenário S13): a Ana preparou o cadastro de "DANIEL PAGANIN" numa unidade
// onde ele JÁ é o inquilino, e o guard não acusou. Provado no container, com controle positivo:
//   checarConflito('DANIEL PAGANIN')  → false        ← como a pessoa digita
//   checarConflito('DANIEL  PAGANIN') → true         ← copiado byte a byte do ERP (2 espaços)
// `norm` fazia trim() mas não colapsava espaço INTERNO. 10 de 1.187 contatos numa amostra de 5
// condomínios têm isso. Com a gravação ligada, é a mesma pessoa cadastrada 2× na unidade.
const COM_ESPACO_DUPLO = [
  { st_nome_con: 'HELIO SEGNINI ', st_cpf_con: '', id_contato_con: '900' },
  { st_nome_con: 'DANIEL  PAGANIN', st_cpf_con: '', id_contato_con: '901' }, // como o ERP devolve
];
const conflitoRosa = (d) => cadastroInquilino.checarConflito({}, { id_condominio: '172', id_unidade: '13067', ...d },
  { responsaveisIndex: async () => COM_ESPACO_DUPLO });

await t('ERP com 2 espaços, pessoa digita 1 → conflito (o caso real do S13)', async () => {
  const r = await conflitoRosa({ nome: 'DANIEL PAGANIN', cpf: '41106335244' });
  assert.equal(r.conflito, true, 'o espaço a mais no cadastro do ERP cegou o guard de duplicata');
});

await t('o inverso também: pessoa digita 2 espaços, ERP tem 1 → conflito', async () => {
  const r = await conflito({ nome: 'Bruno  Muller  de Souza', cpf: '11144477735' });
  assert.equal(r.conflito, true, 'espaço extra digitado pela pessoa quebrou a comparação');
});

await t('espaço no fim do nome do ERP continua sem atrapalhar', async () => {
  const r = await conflitoRosa({ nome: 'Helio Segnini', cpf: '11144477735' });
  assert.equal(r.conflito, true, 'o trim() regrediu');
});

await t('🔴 CONTROLE: colapsar espaço NÃO pode passar a casar nome PARCIAL', async () => {
  // Decisão registrada em 16/07: casar parcial arrisca falso-positivo em famílias homônimas.
  // Colapsar espaço é normalização da MESMA string — não pode abrir essa porta de carona.
  const r = await conflito({ nome: 'Muller de Souza', cpf: '11144477735' });
  assert.equal(r.conflito, false, 'nome parcial passou a casar — isso barra cadastro legítimo de parente');
});

console.log('\n[2] controle: pessoa NOVA entra normalmente (o guard não pode travar tudo)');

await t('nome e CPF novos → SEM conflito', async () => {
  const r = await conflito({ nome: 'Joana Pereira Lima', cpf: '52998224725' });
  assert.equal(r.conflito, false, 'travou um cadastro legítimo — o guard virou bloqueio geral');
});

await t('CPF vazio dos DOIS lados não casa por acidente', async () => {
  // Contato sem CPF no cadastro + morador sem CPF: '' === '' seria um falso conflito com QUALQUER um.
  const semCpf = [{ st_nome_con: 'ALGUEM SEM CPF', st_cpf_con: '', id_contato_con: '1' }];
  const r = await cadastroInquilino.checarConflito({}, { ...base, nome: 'Joana Pereira Lima', cpf: '' }, { responsaveisIndex: async () => semCpf });
  assert.equal(r.conflito, false, 'dois CPFs vazios casaram entre si');
});

await t('devolve QUEM conflita (o card precisa dizer com quem)', async () => {
  const r = await conflito({ nome: 'Bruno Muller de Souza', cpf: '41499029845' });
  assert.equal(r.candidatos.length, 1);
  assert.equal(r.candidatos[0].id_contato_con, '70487', 'apontou o contato errado');
});

console.log(`\ntest_conflito_duplicata: ${ok} OK`);
