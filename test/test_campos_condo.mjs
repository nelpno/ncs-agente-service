// test_campos_condo.mjs — mapa de campos obrigatórios EXTRA por condomínio (Frente B, Fernando 22/07).
// Módulo DORMANTE (ainda não wired no validar) — este teste trava o contrato antes da integração de amanhã.
import assert from 'node:assert';
import { camposExtra, validarExtras, payloadExtras } from '../src/write/campos_condo.mjs';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// Tivoli (164): 3 extras (data de nascimento + veículo + placa; RG NÃO — é campo geral, não exigência Tivoli)
{
  const ex = camposExtra('164');
  ok(ex.length === 3, 'Tivoli tem 3 campos extra');
  ok(ex.map((c) => c.campo).join(',') === 'data_nascimento,veiculo_modelo,veiculo_placa', 'os 3 campos certos');
  ok(ex.find((c) => c.campo === 'data_nascimento').payload === 'contatos[0][DT_NASCIMENTO_CON]', 'nascimento vai ao ERP (DT_NASCIMENTO_CON)');
  ok(ex.find((c) => c.campo === 'veiculo_placa').payload === null, 'placa NÃO vai ao ERP (card + portaria)');
}

// condomínio sem exigência extra = vazio (byte-idêntico ao de hoje)
{
  ok(camposExtra('179').length === 0, 'condo comum: zero extras');
  ok(camposExtra(undefined).length === 0 && camposExtra(null).length === 0, 'id ausente: zero extras (não quebra)');
  ok(validarExtras('179', {}).length === 0, 'validarExtras de condo comum = sem erros');
}

// validarExtras: erros nomeados quando falta; zero quando completo
{
  const faltando = validarExtras('164', {});
  ok(faltando.length === 3, 'Tivoli sem nada: 3 erros');
  ok(faltando.every((e) => /obrigatório neste condomínio/.test(e)), 'erros com texto-guia (a Ana pede)');
  const completo = validarExtras('164', { data_nascimento: '01/02/2000', veiculo_modelo: 'Gol', veiculo_placa: 'ABC1D23' });
  ok(completo.length === 0, 'Tivoli completo: sem erros');
  ok(validarExtras('164', { data_nascimento: '01/02/2000' }).length === 2, 'faltam 2 (veículo+placa)');
}

// payloadExtras: só o que VAI ao ERP (payload != null); veículo/placa nunca vão
{
  const p = payloadExtras('164', { data_nascimento: '01/02/2000', veiculo_modelo: 'Gol', veiculo_placa: 'ABC1D23' });
  ok(p['contatos[0][DT_NASCIMENTO_CON]'] === '01/02/2000', 'nascimento entra no payload');
  ok(!('contatos[0][ST_PLACA]' in p) && Object.keys(p).length === 1, 'veículo/placa NÃO entram no payload (só 1 campo ao ERP)');
  ok(Object.keys(payloadExtras('179', { data_nascimento: 'x' })).length === 0, 'condo comum: payload extra vazio');
}

console.log(`test_campos_condo: ${n}/${n} OK`);
