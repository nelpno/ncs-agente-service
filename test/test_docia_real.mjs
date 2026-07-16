// test_docia_real.mjs — AO VIVO contra um contrato REAL do cliente (escaneado, 4 páginas, zero texto).
//
// PULA SOZINHO sem a chave/fixture (CI): os contratos reais têm PII (CPF, RG, nomes) e por isso vivem em
// <raiz NCS>/.tmp/docia_fixtures/ — fora do repo. O gabarito também (expected.json), para que nenhum
// nome real entre no git. Este arquivo só afirma propriedades ESTRUTURAIS.
//
// Rodar: node test/test_docia_real.mjs   (Bash com dangerouslyDisableSandbox — chama o Gemini)
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(process.cwd(), '../../.tmp/docia_fixtures');
const KEY = path.resolve(process.cwd(), '../../.tmp/gemini_key.txt');
const PDF = path.join(DIR, 'locacao-particular.pdf');
const GAB = path.join(DIR, 'expected.json');

if (!fs.existsSync(PDF) || !fs.existsSync(KEY) || !fs.existsSync(GAB)) {
  console.log('PULADO — teste AO VIVO: sem fixture real/chave Gemini em .tmp/ (esperado no CI)');
  process.exit(0);
}
process.env.GEMINI_API_KEY = fs.readFileSync(KEY, 'utf8').trim();

const { analisarContrato } = await import('../src/docia/docia.mjs');
const { validarCPF } = await import('../src/docia/conferir.mjs');

let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };
const gab = JSON.parse(fs.readFileSync(GAB, 'utf8'));
let pular = false;

const r = await analisarContrato(
  [{ mime: 'application/pdf', buf: fs.readFileSync(PDF), nome: 'contrato.pdf' }],
  {
    hoje: new Date('2026-07-15T12:00:00Z'),
    // ERP simulado com o proprietário CERTO (o cruzamento real tem teste próprio)
    erp: { unidade_existe: true, unidade_label: gab.unidade_label, proprietario_nome: gab.locador_nome, condominio_nome: gab.condominio },
    origem: { canal: 'teste' },
  }
);

// Falha de INFRA (sem rede/chave/cota) não é regressão do DocIA — este teste afirma a ANÁLISE.
// Sem isto o teste fica vermelho quando a suíte roda sandboxed (as fixtures existem em .tmp/, então
// ele não pula, tenta chamar o Gemini e morre sem outbound) e a próxima sessão lê isso como bug.
// Motivo de CONTEÚDO (ilegivel, json_invalido) continua reprovando — aí é o motor mesmo.
// ⚠️ exitCode + return, NUNCA process.exit() aqui: com timer de AbortSignal ainda pendente o Node
// (Windows) estoura "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" e devolve 127 DEPOIS de
// imprimir "PULADO" — um pulo vira falha vermelha e a próxima sessão lê como regressão.
if (!r.ok && ['erro', 'http', 'sem_gemini', 'vazio'].includes(r.motivo)) {
  console.log(`PULADO — LLM inacessível (motivo=${r.motivo}${r.detalhe ? ': ' + String(r.detalhe).slice(0, 90) : ''}). Rode com dangerouslyDisableSandbox p/ valer.`);
  process.exitCode = 0;
  pular = true;
}
if (!pular) { await main(); }
async function main() {
ok(r.ok === true, `análise concluiu (motivo=${r.motivo || '—'})`);
if (!r.ok) { console.log('❌ abortou:', JSON.stringify(r).slice(0, 300)); process.exitCode = 1; return; }
const L = r.laudo;
const st = (i) => L.conferencias.find((c) => c.item === i)?.status;

console.log(`\n--- laudo: parecer=${L.parecer} confianca=${L.confianca} descartados=${L.descartados.length} ---`);
for (const c of L.conferencias) console.log(`  [${c.status.padEnd(15)}] ${c.item}: ${c.evidencia.slice(0, 92)}`);
console.log('');

// ---------- leu o documento de fato ----------
ok(L.paginas.length === 4, `4 páginas lidas (veio ${L.paginas.length})`);
ok(L.paginas.every((p) => p.legibilidade === 'ok'), 'todas as páginas legíveis');

// O papel diz "Instrumento PARTICULAR de Contrato de Locação" e não tem imobiliária nenhuma.
// Classificar errado aqui cobra "dados da imobiliária" que não existem = PENDÊNCIA FANTASMA na tela do
// aprovador. Pendência fantasma é pior que inútil: ensina o aprovador a ignorar pendência.
ok(L.tipo_documento === 'locacao_particular', `tipo classificado como locacao_particular (veio: ${L.tipo_documento})`);
ok(!L.conferencias.some((c) => c.item === 'dados_imobiliaria'), 'não cobra dados de imobiliária num contrato particular');
ok(L.pendencias.length === 0 || !L.pendencias.some((p) => /imobiliária/i.test(p)), 'sem pendência fantasma de imobiliária');

// ---------- extraiu as partes certas (gabarito fora do git) ----------
ok(L.campos_extraidos.locador?.nome?.toUpperCase().includes(gab.locador_sobrenome), 'locador extraído');
ok(L.campos_extraidos.locatario?.nome?.toUpperCase().includes(gab.locatario_sobrenome), 'locatário extraído');
ok(String(L.campos_extraidos.unidade?.valor || '').includes(gab.unidade), `unidade ${gab.unidade} extraída`);
ok(String(L.campos_extraidos.bloco?.valor || '').includes(gab.bloco), `bloco ${gab.bloco} extraído`);

// CPF: o original traz "414.990.298/45" (barra no lugar do hífen). O dígito verificador é VÁLIDO —
// quem tem que aguentar a pontuação torta é o nosso normalizador, não o contrato.
ok(validarCPF(L.campos_extraidos.locatario?.cpf) === true, 'CPF do locatário passa no dígito verificador apesar da pontuação torta do original');
ok(st('cpf_partes') === 'ok', 'conferência de CPF das partes: ok');

// ---------- o que só a VISÃO pega ----------
ok(L.assinaturas.length >= 2, `assinaturas localizadas (${L.assinaturas.length})`);
ok(st('assinatura_locador') === 'ok', 'assinatura do locador localizada (pág. 3)');
ok(st('assinatura_locatario') === 'ok', 'assinatura do locatário localizada (pág. 3)');
ok(st('assinatura_no_campo_certo') === 'ok', 'cada assinatura está no campo da parte certa');

// ---------- datas ----------
ok(L.campos_extraidos.vigencia?.fim === gab.vigencia_fim, `término da vigência = ${gab.vigencia_fim}`);
ok(st('vigencia_valida') === 'ok', 'contrato vigente em 15/07/2026');

// ---------- A ARMADILHA DA CLÁUSULA ----------
// O contrato diz: "Pagará o LOCATÁRIO ao LOCADOR o valor mensal de R$ X a título de aluguel e o valor
// mensal de R$ Y a título de condomínio". O inquilino paga a taxa AO LOCADOR → quem responde perante o
// condomínio segue sendo o PROPRIETÁRIO. Ler isso como "inquilino paga condomínio" inverteria o flip e
// faria sair boleto DUPLICADO — exatamente o dano que o Fernando quis evitar.
// A anotação à mão da própria recepção no papel confirma: "Enviar e-mail de cobranças p/ proprietário".
const rt = L.campos_extraidos.responsavel_taxa?.valor;
ok(rt !== 'inquilino', `NÃO cai na armadilha da cláusula do condomínio (extraiu: ${rt === null ? 'null → a Ana pergunta' : rt})`);

// ---------- o verificador não derrubou o mundo ----------
ok(L.descartados.length <= 3, `poucos campos sem âncora (${L.descartados.length}): ${L.descartados.map((d) => d.onde).join(', ') || '—'}`);
ok(L.conferencias.every((c) => c.evidencia && c.evidencia !== '—'), 'toda conferência carrega evidência para o aprovador verificar');

// ---------- parecer coerente ----------
ok(['aprovado', 'pendente', 'reprovado'].includes(L.parecer), 'parecer é um dos três do checklist do cliente');
ok(L.parecer !== 'reprovado', 'contrato real saudável não é reprovado');

const tok = (L.uso?.leitura?.in || 0) + (L.uso?.extracao?.promptTokenCount || 0);
console.log(`\n(custo: ~${tok} tokens de entrada nos 2 passos)`);
console.log(falhas === 0 ? '✅ todos os checks passaram' : `❌ ${falhas} falha(s)`);
process.exitCode = falhas ? 1 : 0;
}
