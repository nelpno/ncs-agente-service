// Testa as funções puras _match e _parseUnidade do resolver de identidade (sem API, sem PII — dados fake).
import { _match, _parseUnidade } from '../src/superlogica.mjs';

const R = (over) => ({ st_cpf_con: '', st_telefone_con: '', st_nome_con: '', st_bloco_uni: '', st_unidade_uni: '', ...over });
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
const q = ({ cpf, tel, nome, unidade }) => { const d = (s) => (s || '').replace(/\D/g, ''); const t = d(tel); return { cpfd: d(cpf), telTail: t.length >= 8 ? t.slice(-8) : null, nomeN: norm(nome), unidadeQ: unidade ? _parseUnidade(unidade) : null }; };

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

// --- _parseUnidade ---
ck('parse "Ap. 111 Torre 2"', _parseUnidade('Ap. 111 Torre 2'), { num: '111', bloco: '2' });
ck('parse "apto 142 torre 2"', _parseUnidade('apto 142 torre 2'), { num: '142', bloco: '2' });
ck('parse "Bloco 7 apartamento 401"', _parseUnidade('Bloco 7 apartamento 401'), { num: '401', bloco: '7' });
ck('parse "unidade 506" (sem bloco)', _parseUnidade('unidade 506'), { num: '506', bloco: null });
ck('parse sem numero', _parseUnidade('não lembro'), null);

// --- identificacao por UNIDADE + NOME (ponto cego corrigido) ---
ck('unidade(num+bloco)+nome -> alta 88', _match(R({ st_nome_con: 'LUCIANA SPINOSA', st_unidade_uni: '111', st_bloco_uni: 'Torre 2' }), q({ nome: 'Luciana Spinosa', unidade: 'Ap 111 Torre 2' })), { criterio: 'unidade_nome', score: 88 });
ck('unidade(num)+nome SEM bloco informado -> 88 (num+nome forte)', _match(R({ st_nome_con: 'CICERA BRAGA DE OLIVEIRA', st_unidade_uni: '142', st_bloco_uni: 'Torre 2' }), q({ nome: 'Cicera Braga', unidade: 'apartamento 142' })), { criterio: 'unidade_nome', score: 88 });
ck('unidade(num)+nome com bloco DIVERGENTE -> 82', _match(R({ st_nome_con: 'CICERA BRAGA DE OLIVEIRA', st_unidade_uni: '142', st_bloco_uni: 'Torre 2' }), q({ nome: 'Cicera Braga', unidade: 'apto 142 torre 5' })), { criterio: 'unidade_nome', score: 82 });
ck('unidade bate mas NOME nao -> fraca (nao libera)', _match(R({ st_nome_con: 'OUTRA PESSOA', st_unidade_uni: '111', st_bloco_uni: 'Torre 2' }), q({ nome: 'Luciana Spinosa', unidade: 'Ap 111 Torre 2' })), { criterio: 'unidade_fraca', score: 35 });
ck('unidade NAO bate (num diferente) -> cai no nome', _match(R({ st_nome_con: 'LUCIANA SPINOSA', st_unidade_uni: '999', st_bloco_uni: 'Torre 2' }), q({ nome: 'Luciana Spinosa', unidade: 'Ap 111 Torre 2' })), { criterio: 'nome_exato', score: 60 });
ck('cpf vence unidade+nome (prioridade)', _match(R({ st_cpf_con: '11122233344', st_nome_con: 'LUCIANA SPINOSA', st_unidade_uni: '111' }), q({ cpf: '11122233344', nome: 'Luciana Spinosa', unidade: 'Ap 111' })), { criterio: 'cpf', score: 100 });
ck('unidade+nome vence nome puro', _match(R({ st_nome_con: 'LUCIANA SPINOSA', st_unidade_uni: '111' }), q({ nome: 'Luciana Spinosa', unidade: 'apto 111' })), { criterio: 'unidade_nome', score: 88 });

console.log(`\n${pass} OK / ${fail} FALHAS`);
process.exit(fail ? 1 : 0);
