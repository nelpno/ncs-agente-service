// test_alerta_contrato_recebido.mjs — o card não pode afirmar que o contrato NÃO VEIO quando ele veio.
//
// POR QUE ISTO EXISTE (caso real, 10/08/2026, conversa 848 / rascunho 5efbdd8602285d0c): o Deives
// mandou o contrato de locação às 13:14, a Ana LEU o documento ("Documento lido pela Ana: Este é um
// Contrato de Locação Residencial... Locadora: SIMONE APARECIDA GOMES") e às 13:18 criou o cadastro
// do Ivan. Ela perguntou "é só essa página ou tem mais alguma?", ele respondeu outra coisa, e a
// conferência (`analisar_contrato`) NUNCA rodou — então `laudo` ficou null e o card estampou:
//
//     "Não veio contrato de locação nesta conversa — peça e confira antes de aprovar."
//
// A equipe leu isso como fato e passou a tarde pedindo ao cliente um documento que ele já havia
// enviado. O alerta media a AUSÊNCIA DE LAUDO e afirmava AUSÊNCIA DE CONTRATO — coisas diferentes.
//
// Agora o rascunho carrega `documento_recebido` (o dossiê tinha páginas quando o cadastro nasceu) e
// o card distingue os dois casos. Continua sendo alerta, não trava: quem aprova é a equipe.
//
// Uso: node test/test_alerta_contrato_recebido.mjs

import { cadastroInquilino } from '../src/write/actions/cadastro_inquilino.mjs';

let failures = 0;
function assert(condition, label) {
  if (condition) console.log('  OK  ', label);
  else { console.error('  FAIL', label); failures++; }
}

const SNAP = [{ st_nome_con: 'SIMONE APARECIDA GOMES', id_label_tres: '1', dt_saida_res: '' }];
const base = {
  id_condominio: '176', id_unidade: '13661', unidade_label: 'TORRE 03 - BLOCO A / 004',
  nome: 'Ivan Gonçalves Rabatini', papel: 'inquilino', data_entrada: '12/08/2026',
  cpf: '52998224725', email: 'ivan.rabatini@hotmail.com', telefone: '16997874645',
  docia_ativo: true, laudo: null,
};
const alertasDe = (d) => (cadastroInquilino.render(d, SNAP).alertas || []).join(' | ');

console.log('\n=== test_alerta_contrato_recebido.mjs ===\n');

// 1. O caso real: documento CHEGOU, conferência não rodou.
{
  const txt = alertasDe({ ...base, documento_recebido: true });
  assert(/contrato/i.test(txt), 'ainda alerta sobre o contrato (a equipe precisa conferir)');
  assert(!/n[ãa]o veio/i.test(txt), 'NÃO afirma "não veio" — o documento veio');
  assert(/confer/i.test(txt), 'diz que o que faltou foi a CONFERÊNCIA');
}

// 2. CONTROLE — nada chegou: o texto de antes continua valendo.
{
  const txt = alertasDe({ ...base, documento_recebido: false });
  assert(/n[ãa]o veio contrato/i.test(txt), 'sem documento → segue dizendo que não veio');
}

// 3. CONTROLE — rascunho ANTIGO (sem o campo): não pode passar a mentir para o outro lado.
//    Sem o sinal, o comportamento tem de ser o conservador de sempre.
{
  const txt = alertasDe({ ...base });
  assert(/n[ãa]o veio contrato/i.test(txt), 'rascunho sem o campo → texto de sempre (compatibilidade)');
}

// 4. CONTROLE — com laudo não há alerta nenhum de contrato, venha o documento ou não.
{
  const comLaudo = { ...base, laudo: { itens: [], parecer: 'aprovado' }, documento_recebido: true };
  assert(!/n[ãa]o veio contrato|n[ãa]o passou pela confer/i.test(alertasDe(comLaudo)), 'com laudo, nenhum alerta de contrato ausente');
}

// 5. CONTROLE — dependente não precisa de contrato (regra do Fernando), com ou sem documento.
{
  const dep = { ...base, papel: 'dependente', solicitante_nome: 'SIMONE APARECIDA GOMES', documento_recebido: false };
  assert(!/contrato/i.test(alertasDe(dep)), 'dependente não recebe alerta de contrato');
}

// 6. CONTROLE — leitura DESLIGADA não alerta (senão seria alarme em 100% dos cards).
{
  assert(!/contrato/i.test(alertasDe({ ...base, docia_ativo: false, documento_recebido: false })), 'DocIA desligado → sem alerta de contrato');
}

console.log(failures === 0 ? '\n✅ todos passaram\n' : `\n❌ ${failures} falha(s)\n`);
process.exit(failures === 0 ? 0 : 1);
