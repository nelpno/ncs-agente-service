// Testa a função pura _match do resolver de identidade (sem API, sem PII — dados fake).
import { _match } from '../src/superlogica.mjs';

const R = (over) => ({ st_cpf_con: '', st_telefone_con: '', st_nome_con: '', ...over });
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
const q = ({ cpf, tel, nome }) => { const d = (s) => (s || '').replace(/\D/g, ''); const t = d(tel); return { cpfd: d(cpf), telTail: t.length >= 8 ? t.slice(-8) : null, nomeN: norm(nome) }; };

let pass = 0, fail = 0;
const ck = (label, got, exp) => { const ok = JSON.stringify(got) === JSON.stringify(exp); console.log((ok ? 'OK ' : 'XX ') + label + ' -> ' + JSON.stringify(got)); ok ? pass++ : fail++; };

ck('cpf exato (mascaras diferentes)', _match(R({ st_cpf_con: '123.456.789-00' }), q({ cpf: '12345678900' })), { criterio: 'cpf', score: 100 });
ck('telefone ultimos 8 (mascaras/ddd)', _match(R({ st_telefone_con: '(16) 99876-5432' }), q({ tel: '+55 16 99876-5432' })), { criterio: 'telefone', score: 80 });
ck('telefone nao bate', _match(R({ st_telefone_con: '1633334444' }), q({ tel: '16999998888' })), null);
ck('nome exato', _match(R({ st_nome_con: 'MARIA DA SILVA' }), q({ nome: 'maria da silva' })), { criterio: 'nome_exato', score: 60 });
ck('nome completo (tokens presentes)', _match(R({ st_nome_con: 'MARIA APARECIDA DA SILVA SOUZA' }), q({ nome: 'Maria Souza' })), { criterio: 'nome_completo', score: 50 });
ck('nome parcial', _match(R({ st_nome_con: 'JOAO' }), q({ nome: 'joao pedro' })), { criterio: 'nome_parcial', score: 30 });
ck('cpf vence telefone (prioridade)', _match(R({ st_cpf_con: '11122233344', st_telefone_con: '1699999' }), q({ cpf: '11122233344', tel: '16999998888' })), { criterio: 'cpf', score: 100 });
ck('homonimo diferente (nao casa)', _match(R({ st_nome_con: 'CARLOS' }), q({ nome: 'ana' })), null);

console.log(`\n${pass} OK / ${fail} FALHAS`);
process.exit(fail ? 1 : 0);
