// test_manual_proprietario.mjs — determinístico, sem LLM, sem rede.
// A tool entrega o manual da construtora INTEIRO, como anexo. Os dois lados importam:
//   (a) o condomínio que TEM manual recebe;
//   (b) todo o resto NÃO recebe — falha fechada. Entregar o manual de um prédio a morador de outro
//       seria pior que não entregar nada, e "não achei o nome" NUNCA pode virar "mando o que tenho".
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  consultar_manual_proprietario, servirManual, _carregar, _registrarParaTeste,
} from '../src/manual_proprietario.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let ok = 0, total = 0;
const check = (c, m) => { total++; assert(c, m); ok++; };

// ---------- catálogo ----------
const base = _carregar();
check(base.length >= 1, 'catálogo tem ao menos 1 manual');
for (const m of base) {
  const p = path.join(RAIZ, 'data', 'documentos', m.arquivo);
  check(fs.existsSync(p), `o arquivo de ${m.nome} existe em disco: ${m.arquivo}`);
  const head = fs.readFileSync(p).subarray(0, 5).toString('latin1');
  check(head === '%PDF-', `o arquivo de ${m.nome} é um PDF de verdade (magic bytes), não um HTML de erro`);
  check(m.slug && m.nome && m.titulo, `${m.nome} tem slug, nome e titulo`);
}

// ---------- (a) quem TEM manual recebe ----------
for (const pedido of ['Seiva', 'SEIVA', 'seiva', 'Seiva Vila Harmonia', 'SEIVA VILA HARMONIA']) {
  const r = consultar_manual_proprietario({ condominio: pedido });
  check(r.ok === true, `"${pedido}" recebe o manual`);
  check(/^https?:\/\/.+\/manual\/[0-9a-f]{32}$/.test(r.url), `"${pedido}" devolve URL de token, não caminho de disco (${r.url})`);
  check(/\.pdf$/i.test(r.filename), `"${pedido}" devolve filename .pdf`);
  check(r.condominio === 'SEIVA VILA HARMONIA', `"${pedido}" resolve para o condomínio certo`);
}

// ---------- (b) falha FECHADA ----------
const semManual = consultar_manual_proprietario({ condominio: 'lume' });
check(semManual.ok === false, 'condomínio conhecido SEM manual não recebe nada');
check(semManual.motivo === 'condominio_sem_manual', `motivo honesto p/ quem não tem manual (veio ${semManual.motivo})`);
check(!semManual.url, 'condomínio sem manual NÃO recebe url');

const inexistente = consultar_manual_proprietario({ condominio: 'Condominio Que Nao Existe XPTO' });
check(inexistente.ok === false, 'condomínio desconhecido não recebe nada');
check(!inexistente.url, 'condomínio desconhecido NÃO recebe url');

const vazio = consultar_manual_proprietario({});
check(vazio.ok === false && vazio.motivo === 'condominio_nao_informado', 'sem condomínio, PERGUNTA — nunca escolhe sozinho');
check(!vazio.url, 'sem condomínio NÃO recebe url');

// o caso que mataria a feature: nome que não casa NINGUÉM não pode devolver "o único que existe".
// _filtrarCondos devolve a lista INTEIRA quando nada casa — se o módulo lesse isso como acerto,
// com 1 manual no catálogo QUALQUER texto entregaria o manual da Seiva.
const errado = consultar_manual_proprietario({ condominio: 'Spazzio aboccato' });
check(errado.ok === false, 'nome que não casa ninguém NÃO recebe o manual (com 1 item no catálogo, este é o furo real)');

// ---------- token ----------
const bom = consultar_manual_proprietario({ condominio: 'Seiva' });
const tok = bom.url.split('/').pop();
const pdf = servirManual(tok);
check(Buffer.isBuffer(pdf) && pdf.subarray(0, 5).toString('latin1') === '%PDF-', 'o token serve o PDF íntegro');
check(pdf.length > 100000, `o PDF servido tem tamanho de manual (veio ${pdf.length} bytes)`);
check(servirManual('naoexiste') === null, 'token inválido devolve null');
check(servirManual('') === null, 'token vazio devolve null');

// expiração: token vencido não serve mais (senão a URL vira link público eterno)
const tokVencido = _registrarParaTeste(path.join(RAIZ, 'data', 'documentos', base[0].arquivo), -1000);
check(servirManual(tokVencido) === null, 'token EXPIRADO devolve null');

// ---------- autoteste do MECANISMO que segura tudo isso ----------
// O guard depende de um sentinela injetado na lista: se ele sobrevive ao filtro, nada foi filtrado.
// Sem este autoteste, no dia em que _filtrarCondos mudar de comportamento o guard vira no-op EM
// SILÊNCIO e o catálogo de 1 item passa a ser entregue para qualquer texto.
{
  const { _filtrarCondos } = await import('../src/superlogica.mjs');
  const SENT = { nome: 'QQQ NENHUM CONDOMINIO QQQ', slug: '__sentinela__' };
  const lista = [{ nome: 'SEIVA VILA HARMONIA', slug: 'seiva' }, SENT];

  const naoCasa = _filtrarCondos(lista, 'Spazzio aboccato');
  check(naoCasa.some((c) => c.slug === '__sentinela__'),
    'AUTOTESTE: quando NADA casa, o sentinela SOBREVIVE ao filtro (é assim que detectamos "não achei")');

  const casa = _filtrarCondos(lista, 'Seiva');
  check(!casa.some((c) => c.slug === '__sentinela__'),
    'AUTOTESTE: quando ALGO casa, o sentinela é FILTRADO FORA (senão o guard recusaria acerto legítimo)');
}

console.log(`test_manual_proprietario: ${ok}/${total} OK`);
