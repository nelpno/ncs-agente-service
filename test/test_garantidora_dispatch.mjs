// test_garantidora_dispatch.mjs — determinístico, sem rede.
import { planejarAvisoGarantidora } from '../src/garantidora_dispatch.mjs';

let ok = 0, fail = 0;
const check = (n, c) => { if (c) ok++; else { fail++; console.log(`  ❌ ${n}`); } };
const morador = { nome: 'Novo Dono', unidade: 'Apto 10', cpf: '123.456.789-00', email: 'd@x.com', telefone: '16 99999-0000' };

// Vale Supremo (id 186, total, Assiscon) → e-mail
const p1 = planejarAvisoGarantidora({ id_condominio: 186, morador, documento: 'Escritura' });
check('Vale Supremo → enviar_email', p1.acao === 'enviar_email');
check('Vale Supremo → Assiscon', p1.garantidora === 'ASSISCON');
check('Vale Supremo → e-mail rp@assiscongarantias.com.br', p1.email?.para === 'rp@assiscongarantias.com.br');
check('Vale Supremo → corpo cita o documento', /Escritura/.test(p1.email?.corpo || ''));

// Flores (id 182, total, Condinvest) → e-mail
const p2 = planejarAvisoGarantidora({ id_condominio: 182, morador });
check('Flores → enviar_email p/ Condinvest', p2.acao === 'enviar_email' && p2.email?.para === 'boletos01@condinvest.com.br');

// Allure (id 62, allure) → nenhuma
const p3 = planejarAvisoGarantidora({ id_condominio: 62, morador });
check('Allure → acao nenhuma', p3.acao === 'nenhuma' && p3.tipo === 'allure');

// condo sem garantidora → nenhuma
const p4 = planejarAvisoGarantidora({ id_condominio: 99999, morador });
check('sem garantidora → nenhuma', p4.acao === 'nenhuma' && p4.tem === false);

// por NOME (sem id) → resolve
const p5 = planejarAvisoGarantidora({ condominio_nome: 'Vale Supremo', morador });
check('por nome "Vale Supremo" → enviar_email', p5.acao === 'enviar_email');

console.log(`\n${fail === 0 ? '✅' : '❌'} garantidora_dispatch: ${ok} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
