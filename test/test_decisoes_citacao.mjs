// test_decisoes_citacao.mjs — guarda das DECISOES HUMANAS do Fernando sobre qual trecho do
// RI/Convencao fundamenta cada infracao (gerador/decisoes/decisoes-citacao.json, respondidas em 04/08/2026).
//
// Por que este teste existe: extrair-catalogo.mjs REESCREVE texto_artigo/fundamento. Se alguem re-extrair
// um destes catalogos e esquecer de rodar `node gerador/decisoes/aplicar-decisoes.mjs APPLY=1`, a decisao
// do cliente e desfeita EM SILENCIO e o documento volta a citar o artigo errado. Aqui isso fica vermelho.
//
// Determinístico: so le arquivos do repo, sem LLM e sem rede.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SERVICO = path.resolve(AQUI, '..');
const DADOS = path.join(SERVICO, 'gerador/dados');
const REGIMENTOS = path.join(SERVICO, 'data/regimentos');
const DECISOES = path.join(SERVICO, 'gerador/decisoes/decisoes-citacao.json');

let falhas = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK ' : 'FALHA'} ${msg}`); if (!cond) falhas++; };
const collapse = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const provaNorm = (s) => collapse(s).replace(/\s+:/g, ':').replace(/:\s*:/g, ':').toLowerCase();

// ---------------------------------------------------------------- 1) o arquivo de decisoes existe
ok(fs.existsSync(DECISOES), 'gerador/decisoes/decisoes-citacao.json existe (registro das respostas do Fernando)');
if (!fs.existsSync(DECISOES)) { console.log('\n1 FALHA(S)'); process.exit(1); }
const dec = JSON.parse(fs.readFileSync(DECISOES, 'utf8'));
ok(Array.isArray(dec.decisoes) && dec.decisoes.length >= 8, `tem ao menos as 8 decisoes de 04/08 (tem ${dec.decisoes.length})`);

// ---------------------------------------------------------------- 2) cada decisao esta APLICADA no catalogo
for (const d of dec.decisoes) {
  const arq = path.join(DADOS, d.slug + '.json');
  if (!fs.existsSync(arq)) { ok(false, `${d.slug}: catalogo existe`); continue; }
  const inf = (JSON.parse(fs.readFileSync(arq, 'utf8')).catalogo_infracoes || {})[d.id];
  if (!inf) { ok(false, `${d.slug}/${d.id}: infracao existe no catalogo`); continue; }

  // 2a) o item que o Fernando indicou aparece no texto citado
  const txt = collapse(inf.texto_artigo);
  const itensOk = d.itens.every((it) => {
    if (/^§/.test(it)) return new RegExp(`§\\s*${it.replace(/\D/g, '')}`).test(txt);
    return new RegExp(`(^|[\\s;.:(])\\(?${it}\\)`, 'i').test(txt);
  });
  ok(itensOk, `${d.slug}/${d.id}: cita o(s) item(ns) ${d.itens.join(', ')} que o Fernando confirmou`);

  // 2b) o texto NAO pode ser o amplo de antes (a decisao existe justamente para estreitar).
  //     Limite generoso: so pega o caso de "voltou ao artigo inteiro".
  ok(txt.length <= 900, `${d.slug}/${d.id}: citacao estreitada (${txt.length}c <= 900)`);

  // 2c) marca da decisao humana preservada
  ok(!!inf.decisao_humana, `${d.slug}/${d.id}: mantem o registro decisao_humana`);

  // 2d) VERBATIM: cada bloco literal ainda existe na fonte ingerida
  const dir = path.join(REGIMENTOS, d.slug);
  const filtro = d.fonte === 'convencao' ? /^(convencao|estatuto)/i : /^regimento/i;
  const fonte = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith('.md') && filtro.test(f))
        .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n\n')
    : '';
  const nf = provaNorm(fonte);
  const blocos = txt.split(/\s*\(\.\.\.\)\s*/).filter(Boolean);
  const todosNaFonte = blocos.every((b) => nf.includes(provaNorm(b)));
  ok(todosNaFonte, `${d.slug}/${d.id}: texto e VERBATIM da fonte (${blocos.length} bloco(s))`);
}

// ---------------------------------------------------------------- 3) armadilha i/v/x (bug real, 04/08)
// "v" e letra de lista alfabetica E numeral romano. Classificar como romano fez o item v) do Vancouver
// engolir o w) e os PARAGRAFOS seguintes (1218c em vez de 153c). Uma letra sozinha e SEMPRE letra.
function tipoDoItem(it, declarado) {
  if (declarado) return declarado;
  if (/^§/.test(it)) return 'paragrafo';
  if (/^\d+\.\d+$/.test(it)) return 'dec';
  if (/^[IVX]{2,}$/.test(it)) return 'romano';
  return 'letra';
}
for (const letra of ['i', 'v', 'x', 'a', 'd', 's']) {
  ok(tipoDoItem(letra) === 'letra', `tipoDoItem('${letra}') = letra (nao pode virar romano)`);
}
ok(tipoDoItem('IV') === 'romano', "tipoDoItem('IV') = romano");
ok(tipoDoItem('§1') === 'paragrafo', "tipoDoItem('§1') = paragrafo");
ok(tipoDoItem('12.6') === 'dec', "tipoDoItem('12.6') = dec");
ok(tipoDoItem('v', 'romano') === 'romano', 'tipo declarado no JSON vence a inferencia');

// ---------------------------------------------------------------- 4) caso concreto que motivou o bug
const vanc = JSON.parse(fs.readFileSync(path.join(DADOS, 'vancouver.json'), 'utf8')).catalogo_infracoes;
const lixo = collapse(vanc.lixo_areas_comuns.texto_artigo);
ok(!/Fica o sindico autorizado/i.test(lixo), 'vancouver/lixo NAO engole o item w) (bug do "v" como romano)');
ok(!/PAR[ÁA]GRAFO PRIMEIRO/i.test(lixo), 'vancouver/lixo NAO engole os PARAGRAFOS seguintes');

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
