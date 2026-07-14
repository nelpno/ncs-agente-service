// test_templates.mjs — renderTemplate: texto FORA do código, placeholders {{}}, fallback, guard LGPD (sem CPF).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTemplate, _reload } from '../src/templates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const D = path.join(__dirname, '..', 'data', 'templates');

let ok = 0, fail = 0;
const check = (n, c) => { if (c) ok++; else { fail++; console.log(`  ❌ ${n}`); } };

const vars = { papel: 'inquilino', nome: 'Fulano de Tal', unidade: 'Apto 42', condominio: 'Lume', telefone: '16 99999-0000' };

// 1) template existente → placeholders resolvidos, nenhum {{ }} sobra
const t1 = renderTemplate({ evento: 'cadastro', papel: 'portaria', vars });
check('cadastro-portaria: nome resolvido', t1.includes('Fulano de Tal'));
check('cadastro-portaria: unidade resolvida', t1.includes('Apto 42'));
check('cadastro-portaria: condomínio resolvido', t1.includes('Lume'));
check('cadastro-portaria: sem placeholder sobrando', !/\{\{/.test(t1));

const t2 = renderTemplate({ evento: 'cadastro', papel: 'sindico', vars });
check('cadastro-sindico: texto próprio (ciência)', /ciência/.test(t2) && t2.includes('Fulano de Tal'));

const t3 = renderTemplate({ evento: 'titularidade', papel: 'portaria', vars });
check('titularidade-portaria: menciona "atualização de titularidade"', /atualiza(ç|c)ão de titularidade/.test(t3));

const t4 = renderTemplate({ evento: 'titularidade', papel: 'sindico', vars });
check('titularidade-sindico: menciona "atualização de titularidade" + ciência', /titularidade/.test(t4) && /ciência/.test(t4));

// 2) var ausente → vira "—", não quebra nem deixa "undefined"/"null" no texto
const t5 = renderTemplate({ evento: 'cadastro', papel: 'portaria', vars: { ...vars, telefone: undefined } });
check('var ausente vira travessão, sem "undefined"', t5.includes('—') && !/undefined/.test(t5));

// 3) evento/papel sem .md correspondente → fallback textual (não lança, não fica vazio)
const t6 = renderTemplate({ evento: 'evento_inexistente_xyz', papel: 'portaria', vars });
check('sem template → fallback não vazio', typeof t6 === 'string' && t6.length > 0);
check('fallback → menciona o condomínio e o nome', t6.includes('Lume') && t6.includes('Fulano de Tal'));

const t7 = renderTemplate({ evento: 'titularidade', papel: 'papel_sem_template', vars });
check('fallback (titularidade, papel desconhecido) → menciona "titularidade"', /titularidade/.test(t7));

// 4) sem args nenhum → não lança
const t8 = renderTemplate();
check('sem args → não lança, devolve string', typeof t8 === 'string');

// 5) LGPD (spec §6.2): nenhum template deve ter placeholder {{cpf}} — CPF completo é bloqueador aberto
for (const f of fs.readdirSync(D).filter((x) => x.endsWith('.md'))) {
  const conteudo = fs.readFileSync(path.join(D, f), 'utf8');
  check(`LGPD — ${f} não referencia {{cpf}}`, !/\{\{\s*cpf\s*\}\}/i.test(conteudo));
}

// 6) _reload não quebra e o próximo render continua funcionando
_reload();
const t9 = renderTemplate({ evento: 'cadastro', papel: 'portaria', vars });
check('_reload → próximo render funciona normal', t9.includes('Fulano de Tal'));

console.log(`\n${fail === 0 ? '✅' : '❌'} templates: ${ok} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
