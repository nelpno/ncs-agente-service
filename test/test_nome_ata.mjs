// test_nome_ata.mjs — a data do nome do arquivo é o que faz "a última assembleia sobrepõe".
// Se a conversão errar, a ata entra sem data (vai para o fim da ordenação) ou com a data errada
// (uma assembleia velha passa por nova) — e nos dois casos o retriever continua "funcionando".
import { dataDoNome, nomeArquivoAta, jaExiste } from '../scripts/nome_ata.mjs';

let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };
const eq = (a, b, m) => ok(a === b, `${m} → ${a === b ? a : `${a} (esperava ${b})`}`);

// ── nomes REAIS colhidos da pasta do Drive ─────────────────────────────────
eq(dataDoNome('AGO - 08 DE NOVEMBRO DE 2021.pdf'), '2021-11-08', 'AGO + data por extenso');
eq(dataDoNome('AGO - 14 DE MARÇO DE 2025.pdf'), '2025-03-14', 'mês com cedilha e acento');
eq(dataDoNome('AGE - 26 DE NOVEMBRO DE 2025.pdf'), '2025-11-26', 'AGE');
eq(dataDoNome('AGI - 19 DE JULHO DE 2024.pdf'), '2024-07-19', 'AGI');

// 🔴 a armadilha: "AGO" é Assembleia Geral Ordinária, NÃO agosto. Uma leitura ingênua do mês por
// extenso transformaria toda AGO numa ata de agosto — e a ordenação cronológica ficaria embaralhada
// sem nada na tela dizendo isso.
eq(dataDoNome('AGO - 08 DE NOVEMBRO DE 2021.pdf'), '2021-11-08', 'AGO no início NÃO vira agosto');
eq(dataDoNome('AGO 05 DE AGOSTO DE 2024.pdf'), '2024-08-05', '...mas agosto de verdade é agosto');

// ── outros formatos que aparecem ───────────────────────────────────────────
eq(dataDoNome('ata-2025-03-12.md'), '2025-03-12', 'já no formato do RAG (idempotente)');
eq(dataDoNome('Ata 12/03/2025.pdf'), '2025-03-12', 'DD/MM/AAAA');
eq(dataDoNome('assembleia 12-03-2025.pdf'), '2025-03-12', 'DD-MM-AAAA');
eq(dataDoNome('ATA 12.03.2025.pdf'), '2025-03-12', 'DD.MM.AAAA');
eq(dataDoNome('AGO - 1 de maio de 2024.pdf'), '2024-05-01', 'dia sem zero à esquerda');
eq(dataDoNome('AGO - 08 DE NOV DE 2021.pdf'), '2021-11-08', 'mês abreviado');

// ── o outro lado: o que NÃO PODE virar data ────────────────────────────────
ok(dataDoNome('ATA SEM DATA.pdf') === null, 'nome sem data devolve null (não inventa)');
ok(dataDoNome('CONTROLE.xlsx') === null, 'planilha de controle não vira ata');
ok(dataDoNome('AGO - 31 DE FEVEREIRO DE 2025.pdf') === null, '31 de fevereiro não existe');
ok(dataDoNome('AGO - 45 DE MARÇO DE 2025.pdf') === null, 'dia 45 não existe');
ok(dataDoNome('ata 12/13/2025.pdf') === null, 'mês 13 não existe');
ok(dataDoNome('livro 1850.pdf') === null, 'ano fora de faixa não vira data');
ok(dataDoNome('') === null && dataDoNome(null) === null, 'vazio/nulo não quebra');

// ── nome final ─────────────────────────────────────────────────────────────
const n = nomeArquivoAta('AGO - 14 DE MARÇO DE 2025.pdf');
ok(n.ok && n.arquivo === 'ata-2025-03-14.md', `nome final: ${n.arquivo}`);
const r = nomeArquivoAta('ATA SEM DATA.pdf');
ok(!r.ok && r.motivo === 'sem_data_no_nome', 'recusa com motivo, em vez de gravar sem data');

// ── dedup contra o que já está ingerido ────────────────────────────────────
const existentes = ['ata-2026-03-19.md', 'ata-2025-03-21.md', 'ata-2024-07-19.md']; // Lume, em disco
ok(jaExiste('ata-2026-03-19.md', existentes), 'mesma data já ingerida é detectada');
ok(jaExiste('AGI - 19 DE JULHO DE 2024.pdf', existentes), '...mesmo vindo com o nome do Drive');
ok(!jaExiste('AGO - 20 DE MARÇO DE 2026.pdf', existentes), 'data nova não é confundida com existente');
ok(!jaExiste('ATA SEM DATA.pdf', existentes), 'arquivo sem data nunca conta como duplicata');

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
