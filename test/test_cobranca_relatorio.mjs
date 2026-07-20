// test_cobranca_relatorio.mjs — resumo dos BLOQUEADOS pro digest (Fable: nunca some em log; vira contagem empurrada).
import { resumoBloqueados } from '../src/cobranca/relatorio.mjs';

let falhas = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK ' : 'FALHA'} ${msg}`); if (!cond) falhas++; };

// leva fake no shape de montarLevaCondo (só o que o relatório usa)
const leva = {
  condominio_id: 181,
  unidades: [
    { unidade: { id_unidade: 'A', unidade_label: 'Apto 101' }, balde: 'pronto', motivos: [] },
    { unidade: { id_unidade: 'B', unidade_label: 'Apto 102' }, balde: 'bloqueado', motivos: ['sem_email'] },
    { unidade: { id_unidade: 'C', unidade_label: 'Apto 103' }, balde: 'bloqueado', motivos: ['sem_email'] },
    { unidade: { id_unidade: 'D', unidade_label: 'Apto 104' }, balde: 'bloqueado', motivos: ['judicial'] },
    { unidade: { id_unidade: 'E', unidade_label: 'Apto 105' }, balde: 'bloqueado', motivos: ['garantidora'] },
    { unidade: { id_unidade: 'F', unidade_label: 'Apto 106' }, balde: 'revisar', motivos: ['valor_alto'] },
  ],
};

const r = resumoBloqueados(leva);

ok(r.total === 4, `total de bloqueados = 4 (${r.total})`);
ok(r.por_motivo.sem_email === 2, `sem_email = 2 (${r.por_motivo.sem_email})`);
ok(r.por_motivo.judicial === 1, `judicial = 1 (${r.por_motivo.judicial})`);
ok(r.por_motivo.garantidora === 1, `garantidora = 1 (${r.por_motivo.garantidora})`);
ok(Array.isArray(r.unidades) && r.unidades.length === 4, `lista com as 4 unidades bloqueadas (${r.unidades.length})`);
ok(r.unidades.every((u) => u.id && u.label && Array.isArray(u.motivos)), `cada unidade tem id/label/motivos`);

// frase pronta pro digest ("N unidades sem cobrança: X sem e-mail")
ok(typeof r.frase === 'string' && /4/.test(r.frase) && /sem_email|sem e-mail|e-mail/i.test(r.frase),
  `frase do digest gerada ("${r.frase}")`);

// leva sem bloqueados → total 0, frase vazia/neutra
{ const r0 = resumoBloqueados({ unidades: [{ unidade: { id_unidade: 'A' }, balde: 'pronto', motivos: [] }] });
  ok(r0.total === 0, `sem bloqueados -> total 0 (${r0.total})`); }

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(falhas ? 1 : 0);
