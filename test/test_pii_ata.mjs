// test_pii_ata.mjs — ata de assembleia entra no RAG SEM CPF e SEM RG.
//
// Por que existe: as 3 atas do Lume ingeridas em 15/06/2026 estão com "[ilegível]" no lugar do CPF —
// mas isso foi ACIDENTE do OCR (o PDF escaneado estava ruim), não uma regra. Em 06/08 o
// read_file_content do Drive passou a extrair o texto perfeito, com "CPF sob n.º 075.992.948-30" e
// "RG sob n.º 12.718.974" legíveis. Ingerir assim colocaria documento de identidade de síndico,
// secretária e moradores dentro da base que a Ana consulta — e ninguém perceberia, porque o
// resultado continuaria "funcionando".
//
// Proteção que existe por acidente quebra em silêncio quando o método melhora.
import { mascararPII, _temPII } from '../src/pii_ata.mjs';

let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

// ── 1. o que PRECISA ser mascarado (trecho real da ata do Lume 19/03/2026) ──
const real = 'A Assembleia foi presidida pelo Sr. ANGELO RODRIGUES GOLDONI, brasileiro, casado, '
  + 'aposentado, portador do RG sob n.º 12.718.974, portador do CPF sob n.º 075.992.948-30, '
  + 'residente e domiciliado na Rua Didino Vieira da Silva, 507, apartamento 1302';
const lim = mascararPII(real);
ok(!/075\.992\.948-30/.test(lim), 'CPF formatado é removido');
ok(!/12\.718\.974/.test(lim), 'RG formatado é removido');
ok(/ANGELO RODRIGUES GOLDONI/.test(lim), 'o NOME permanece (a ata precisa dizer quem presidiu)');
ok(/apartamento 1302/.test(lim), 'a unidade permanece (é dado do condomínio, não documento)');
ok(/\[removido\]/.test(lim), 'deixa marca do que foi retirado (não apaga em silêncio)');

// variações de escrita que aparecem nas atas
ok(!/375\.913\.908-64/.test(mascararPII('do CPF 375.913.908-64,')), 'CPF sem "sob n.º"');
ok(!/07599294830/.test(mascararPII('CPF: 07599294830 ')), 'CPF sem pontuação (11 dígitos)');
ok(!/46\.062\.632-2/.test(mascararPII('RG sob o nº 46.062.632-2 e')), 'RG com dígito após hífen');
// formatos colhidos da ata REAL do Vancouver (06/04/2026) — 8 pessoas qualificadas numa ata só
ok(!/-7/.test(mascararPII('RG n° 8169562 -7, domiciliado')), 'RG com ESPAÇO antes do hífen não deixa o dígito órfão');
ok(!/88\.926\.81/.test(mascararPII('RG n° 88.926.81, domiciliado')), 'RG em formato irregular (2 grupos)');
ok(!/29512900-1/.test(mascararPII('RG sob n° 29512900-1, domiciliado')), 'RG sem pontos com verificador');
ok(!/28441845883/.test(mascararPII('inscrito no CPF n° 28441845883, RG')), 'CPF de 11 dígitos após "inscrito no"');
ok(!/410\.374\.258-55/.test(mascararPII('CPF sob n.º 410.374.258-55, residente')), '2º CPF do mesmo texto');

// ── 2. o que NÃO PODE ser tocado (o outro lado do detector) ─────────────────
// Sem isto, um mascarador agressivo destrói a ata: valor, percentual, data e CNPJ do condomínio
// são exatamente o que a Ana precisa responder.
const legitimo = 'CNPJ: 56.300.773/0001-48. Aprovado o reajuste de 7% (sete por cento) em 19/03/2026, '
  + 'com 13 votos. Orçamento de R$ 8.800,00 e parcelamento em 9 parcelas de R$ 37,91. '
  + 'CEP 14802-370. Lei 4.591/64. Art. 1.336 do Código Civil. Telefone (16) 2334-0020.';
const l2 = mascararPII(legitimo);
ok(l2 === legitimo, 'texto legítimo passa INTACTO (valor, %, data, CNPJ, CEP, lei, artigo, telefone)');

// o CNPJ do condomínio é público e necessário — nunca confundir com CPF
ok(/56\.300\.773\/0001-48/.test(mascararPII('CNPJ: 56.300.773/0001-48')), 'CNPJ preservado');
ok(/R\$ 101\.893,87/.test(mascararPII('total de R$ 101.893,87 (cento e um mil)')), 'valor em reais preservado');
ok(/14802-370/.test(mascararPII('CEP 14802-370')), 'CEP preservado');

// ── 3. detector auxiliar (usado para ABORTAR a ingestão se algo escapar) ────
ok(_temPII('CPF sob n.º 075.992.948-30') === true, 'detector acha CPF');
ok(_temPII('RG sob n.º 12.718.974') === true, 'detector acha RG');
ok(_temPII(legitimo) === false, 'detector NÃO acusa texto legítimo');
ok(_temPII(lim) === false, 'texto já mascarado passa limpo no detector');

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
