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
// ⚠️ POLÍTICA TROCADA em 08/08/2026. Até aqui este teste exigia o CONTRÁRIO ("o nome permanece,
// a ata precisa dizer quem presidiu"). Quem decidiu: Fernando, reunião de 07/08 (01:00:29),
// tópico 2 do que ele aprovou — a ata entra "sem dado pessoal: CPF, quem participou, quem foi
// presidente da mesa". Ele e o Natanael vão testar exatamente isso no Estagiário.
ok(!/ANGELO RODRIGUES GOLDONI/.test(lim), 'o nome de quem presidiu SAI (decisão do Fernando 07/08)');
ok(/\[nome removido\]/.test(lim), 'fica a marca de que havia um nome ali');
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

// ── 2-bis. nome da MESA: os dois lados, com linhas verbatim das atas reais ──
// O lado que PEGA (assinatura: cargo + documento na mesma linha)
const assin1 = mascararPII('**ALEXANDRE HARLEI FERRARI** — PRESIDENTE (CPF: 123.456.789-00 / RG: 12.718.974)');
ok(!/ALEXANDRE HARLEI FERRARI/.test(assin1), 'assinatura Vida Plena: nome da mesa sai');
ok(/PRESIDENTE/.test(assin1), '...e o CARGO fica (a ata segue dizendo que houve mesa)');
const assin2 = mascararPII('NAIARA AFFONSO AMANCIO CPF: 375.913.908-64 RG: 46.062.632-2 SECRETÁRIA');
ok(!/NAIARA AFFONSO AMANCIO/.test(assin2), 'assinatura Studio Five (outro formato): nome sai');
ok(/SECRET/.test(assin2), '...e o cargo fica mesmo com acento');

// Narrativa: o nome de quem conduz TAMBÉM sai (o tratamento "Sr./Sra." é âncora suficiente de
// pessoa), mas a frase e o CARGO permanecem — é o cargo que dá sentido à deliberação.
const narrativa = mascararPII('O Sr. Alexandre Augusto Scalise, síndico do Condomínio, deu boas-vindas aos presentes.');
ok(!/Alexandre Augusto Scalise/.test(narrativa), 'nome após tratamento sai mesmo sem documento na frase');
ok(/síndico do Condomínio, deu boas-vindas aos presentes/.test(narrativa), '...e a frase inteira sobrevive');

// O lado que NÃO PODE pegar — sem isso o mascarador destrói a deliberação, que é o conteúdo útil
const semPessoa = 'A assembleia aprovou o reajuste da taxa em 7% e o rateio do Espaço Grill em 9 parcelas.';
ok(mascararPII(semPessoa) === semPessoa, 'deliberação sem nome de pessoa fica INTACTA');
const cargoSemDoc = 'O presidente da mesa informou que a taxa será reajustada em 7% a partir de abril.';
ok(mascararPII(cargoSemDoc) === cargoSemDoc, 'cargo citado sem documento não dispara nada');
const entidade = mascararPII('ATA do Condomínio Studio Five — AGO — presidida com CPF: 123.456.789-00');
ok(/Studio Five/.test(entidade), 'nome do CONDOMÍNIO sobrevive numa linha que dispara a regra');
const doisTokens = mascararPII('Reunião no Studio Five, presidida, CPF: 123.456.789-00');
ok(/Studio Five/.test(doisTokens), 'nome próprio de 2 tokens não é confundido com pessoa');

// formato REAL do Studio Five: nome colado ao rótulo, sem pontuação no meio
const colado = mascararPII('LUCAS VICENTE REIS CPF: 123.456.789-00 RG: 12.718.974 PRESIDENTE');
ok(!/LUCAS VICENTE REIS/.test(colado), 'nome colado ao rótulo (sem dois-pontos) também sai');

// pautas em CAIXA ALTA precisam sobreviver — é o conteúdo que a ata serve para responder
for (const pauta of [
  'DELIBERAÇÃO E APROVAÇÃO DA PREVISÃO ORÇAMENTÁRIA E REAJUSTE DA TAXA CONDOMINIAL',
  'APROVAÇÃO E RATEIO COBERTURA PARA O GRILL',
  'PRESTAÇÃO DE CONTAS DO PERÍODO DE JANEIRO A DEZEMBRO DE 2025',
  'OS RELATÓRIOS ESTÃO PUBLICADOS NO SITE DO GRUPO NCS E O RESUMO É ENVIADO NOS BOLETOS',
]) ok(mascararPII(pauta) === pauta, `pauta em caixa alta intacta: "${pauta.slice(0, 38)}…"`);
// endereço do condomínio é público e é o cabeçalho de toda ata
const endereco = 'localizado na Rua Didimo Vieira da Silva, 507 - Vila Ferroviária, Araraquara-SP, CEP 14802-370';
ok(mascararPII(endereco) === endereco, 'endereço do condomínio intacto');

// 🔴 REGRESSÃO REAL (Lume 19/03/2026, achada comparando o disco com o PDF do Drive): a flag `i`
// num regex com \p{Lu} faz case-folding, o token de nome deixa de exigir maiúscula e engole a
// frase. O 2º caso é o que dói: o sentido INVERTE — de "a responsabilidade é de quem reservou"
// (regra geral) para "ele reservou" (fato sobre uma pessoa). Nada acusou: nem o pino, nem o
// verificador semântico, nem a lista de removidos (que usava um regex diferente, sem `i`).
const narrativas = [
  'O Sr. Alexandre informou que a referida manutenção se faz necessária em razão da existência de goteiras',
  'O Sr. Alexandre esclareceu que a responsabilidade é de quem realizou a reserva da quadra',
  'A Sra. Marcela apresentou o orçamento e pediu que os moradores avaliassem as três propostas',
];
for (const f of narrativas) {
  ok(mascararPII(f) === f, `narrativa com nome de 1 token fica intacta: "${f.slice(5, 42)}…"`);
}

// Eleição registrada: o cargo vem antes, com dois-pontos, e o nome NÃO tem tratamento nem
// documento colado — sem a âncora do cargo esse nome ficava. (Lume 19/07/2024, verbatim.)
const eleito = mascararPII('1º CONSELHEIRA FISCAL SUPLENTE: VIVIANE APARECIDA CEREDA FERREIRA, brasileira, casada, '
  + 'Pedagoga Coordenadora Técnica da Secretaria Municipal da Educação, portadora do RG sob o nº 12.718.974');
ok(!/VIVIANE APARECIDA CEREDA FERREIRA/.test(eleito), 'nome de quem foi eleito ao conselho sai');
ok(/Secretaria Municipal da Educação/.test(eleito), '...e o ÓRGÃO onde ela trabalha permanece');
ok(/CONSELHEIRA FISCAL SUPLENTE/.test(eleito), '...e o cargo eleito permanece');

// 🔴 o token de nome começava NO MEIO de uma palavra (Tríade 15/10/2025, verbatim): em
// "E RG Nº 12.718.974" ele começava no "G" de "RG" e o texto virava "E R[nome removido]".
const rgNumero = mascararPII('ARQUITETO, JOSE DA SILVA CPF Nº 123.456.789-00 E RG Nº 12.718.974, RESIDENTE');
ok(!/R\[nome removido\]/.test(rgNumero), 'o rótulo RG não é partido ao meio');
ok(/E RG Nº/.test(rgNumero), '...e "E RG Nº" continua legível');
ok(mascararPII(rgNumero) === rgNumero, 'o mascaramento CONVERGE numa passada só');

// 🔴 "RG" sem fronteira de palavra casava DENTRO de "CA-RG-OS" (Lume 19/07/2024)
const cargos = 'para todos os fins e direitos; OS OUTROS CARGOS FICARAM EM VACÂNCIA E SERÃO APRESENTADOS';
ok(mascararPII(cargos) === cargos, '"CARGOS" não é confundido com o rótulo RG');

// a EMPRESA que a pessoa representa não é a pessoa (trecho real do Studio Five 27/10/2022)
const repr = mascararPII('convidou a mim, Srta. Naiara Affonso Amancio, brasileira, solteira, representante do Grupo NCS, portadora do RG sob o nº 46.062.632-2');
ok(/Grupo NCS/.test(repr), 'a administradora (Grupo NCS) sobrevive ao lado da qualificação');
ok(!/Naiara Affonso Amancio/.test(repr), '...e a pessoa que a representa sai');

// pauta de eleição não é nome de pessoa, mesmo colada ao cargo
for (const pauta of ['ITEM 3 – ELEIÇÃO DE Síndico, Subsíndico e Membros do Conselho',
  'ELEIÇÃO DO CARGO EM VACÂNCIA DE SUBSÍNDICO']) {
  ok(mascararPII(pauta) === pauta, `pauta de eleição intacta: "${pauta.slice(0, 34)}…"`);
}
// endereço cujo logradouro tem "Dr." no nome (cabeçalho de toda ata do Vida Plena)
const avDr = 'localizado na Avenida Dr. Leite de Moraes, n° 951, Vila Xavier';
ok(mascararPII(avDr) === avDr, 'logradouro com "Dr." no nome não é confundido com pessoa');
// nome não atravessa o fim da frase
const duasFrases = mascararPII('presidida pela Sra. Graziela Patricia Delanez Gomes. A seguir foi aprovado o rateio.');
ok(/A seguir foi aprovado o rateio\./.test(duasFrases), 'a frase seguinte ao nome permanece inteira');

// ── 2-ter. bloco de assinatura MULTILINHA (formato do lote do Drive) ────────
// O read_file_content entrega a assinatura assim: nome sozinho numa linha, CPF na seguinte, RG
// depois, cargo por último — às vezes com o rodapé de paginação grudado no nome. As âncoras que
// exigem nome e documento na MESMA linha não pegam isto, e o lote inteiro vazaria o nome da mesa.
const blocoAssinatura = [
  'José Francisco Freitas Caires', '', 'CPF: 074.795.548-42', '', 'RG: 18.819.389', '', 'Presidente', '',
  '4 | Página Luciana Somenzari de Almeida', '', 'CPF: 200.647.228-30', '', 'RG: 26.765.998-2', '', 'Secretária',
].join('\n');
const blocoMasc = mascararPII(blocoAssinatura);
ok(!/José Francisco Freitas Caires/.test(blocoMasc), 'assinatura multilinha: nome do presidente sai');
ok(!/Luciana Somenzari de Almeida/.test(blocoMasc), 'assinatura multilinha: nome com rodapé grudado sai');
ok(/Presidente/.test(blocoMasc) && /Secretária/.test(blocoMasc), '...e os cargos ficam');
ok(blocoMasc.split('\n').length === blocoAssinatura.split('\n').length, '...sem colapsar o bloco');

// o outro lado: linha com nome próprio que NÃO é assinatura (não tem documento logo abaixo)
const naoAssinatura = ['ITEM 4 – Reforma da Fachada', '', 'Os moradores aprovaram o orçamento apresentado.'].join('\n');
ok(mascararPII(naoAssinatura) === naoAssinatura, 'linha de pauta seguida de texto comum fica intacta');

// nome NÃO atravessa quebra de linha (senão a substituição colapsa dois parágrafos num só)
const duasLinhas = 'aprovado o Espaço Grill\nMARCOS ROBERTO GALIANI CPF: 123.456.789-00 PRESIDENTE';
ok(mascararPII(duasLinhas).split('\n').length === 2, 'mascaramento preserva o número de linhas');

// ── 2-quater. CRLF não pode esconder o documento ────────────────────────────
// 🔴 O mascarador era NO-OP no Windows: `_temPII` devolvia false com CRLF e true com LF nos MESMOS
// bytes, então o script imprimia "0 com PII, tudo limpo" e não gravava nada. A verificação virava
// no-op justo onde ela roda (Windows) e ficava cega onde o dado importa (CI e produção são Linux).
// Quem pegou foi o gate do CI. O teste compara os DOIS finais de linha no mesmo texto.
const comQuebras = [
  'A Assembleia foi presidida pelo Sr. ANGELO RODRIGUES GOLDONI, brasileiro, casado,',
  'aposentado, portador do RG sob n.º 12.718.974, portador do CPF sob n.º 075.992.948-30,',
  'residente e domiciliado nesta cidade.',
];
const emLF = comQuebras.join('\n');
const emCRLF = comQuebras.join('\r\n');
ok(_temPII(emLF) === true, 'detector acha o documento com LF');
ok(_temPII(emCRLF) === true, 'detector acha o MESMO documento com CRLF');
ok(_temPII(emLF) === _temPII(emCRLF), 'detector dá o mesmo veredito nos dois finais de linha');
ok(!/075\.992\.948-30/.test(mascararPII(emCRLF)), 'mascarador remove o CPF mesmo com CRLF');
ok(!/12\.718\.974/.test(mascararPII(emCRLF)), 'mascarador remove o RG mesmo com CRLF');
ok(mascararPII(emCRLF).split('\n').length === 3, '...preservando as 3 linhas');

// ── 3. detector auxiliar (usado para ABORTAR a ingestão se algo escapar) ────
ok(_temPII('CPF sob n.º 075.992.948-30') === true, 'detector acha CPF');
ok(_temPII('RG sob n.º 12.718.974') === true, 'detector acha RG');
ok(_temPII(legitimo) === false, 'detector NÃO acusa texto legítimo');
ok(_temPII(lim) === false, 'texto já mascarado passa limpo no detector');

// -- 4. as formas que o LOTE REAL de 212 atas revelou (09/08/2026) -----------------------------
// O guard passou no CI e mesmo assim sobraram 151 CPFs de digito verificador valido em 89 atas.
// Fixture prova o MECANISMO; so o dado real prova a realidade. Cada caso e uma forma copiada do
// lote, com CPFs FICTICIOS de digito valido no lugar dos numeros.
//
// Causa principal: a extracao das atas QUEBRA A LINHA entre o rotulo e o numero (o rotulo "CPF:"
// fecha a linha e o numero abre a seguinte) e o gap do padrao excluia a quebra de linha.
console.log('\n--- formas do lote real de 212 atas ---');

const CPF_FICT = '529.982.247-25';   // digito verificador fecha
const CPF_FICT2 = '411.000.000-97';
const QUEBRA = String.fromCharCode(10); // literal, para o heredoc nao transformar

ok(mascararPII('portadora do CPF:' + QUEBRA + QUEBRA + CPF_FICT + ', domiciliada').includes('[removido]'),
  'rotulo e numero em LINHAS DIFERENTES (a forma que deixou 89 atas sujas)');
ok(mascararPII('qualificada sob n. ' + CPF_FICT2 + ', residente').includes('[removido]'),
  'CPF SEM o rotulo, mas com digito verificador valido');
ok(mascararPII('CPF: 529.982.247.25 e outros').includes('[removido]'),
  'ponto no lugar do hifen antes do digito (8x no lote)');
ok(mascararPII('CPF n. 529. 982.247-25').includes('[removido]'), 'espaco depois do ponto');
ok(mascararPII('CPF n. 529.982.247- 25').includes('[removido]'), 'espaco antes do digito verificador');
ok(mascararPII('RG: 12 345 678, expedido').includes('[removido]'), 'RG com ESPACO separando os grupos');

// ── 09/08/2026: os 6 que sobreviveram ao lote de 212, medidos NAS ATAS EM PRODUCAO ────────────────
// Todos ROTULADOS ("portador do CPF sob o n°", "RG:") e mesmo assim legiveis. O que escapou nao foi
// o rotulo nem a quebra de linha (as duas ja tinham teste) - foi o FORMATO DO NUMERO: a extracao
// deixa o separador PELA METADE. Roseiras II, Vale Supremo e Vila Rio Preto.
// Numeros ficticios com digito valido; os formatos sao os que o dado real trouxe.
console.log('\n--- separador PARCIAL, com rotulo (os 6 do lote de 09/08) ---');
ok(mascararPII('portador do CPF sob o n. 529982247 25, residente').includes('[removido]'),
  'sem ponto nenhum e ESPACO antes do digito ("DDDDDDDDD DD")');
ok(mascararPII('do CPF sob o n. 529982.247-25, residente').includes('[removido]'),
  'falta o PRIMEIRO ponto ("DDDDDD.DDD-DD")');
ok(mascararPII('portador do CPF sob o n. 529982247-25, residente').includes('[removido]'),
  'sem pontos, so o hifen ("DDDDDDDDD-DD")');
ok(mascararPII('RG: 529982.247-25 Secretaria').includes('[removido]'),
  'numero em forma de CPF rotulado como RG (Vale Supremo)');
ok(mascararPII('inscrito no CPF n.529.982,247-25, RG sob n. 12.345.678').includes('[removido]'),
  'VIRGULA no lugar do ponto (Piemonte) - aparece no diff da propria correcao');

// ── documento com a CONTAGEM DE DIGITOS corrompida pela extracao ───────────────────────────────────
// 30 ocorrencias no lote, em 14 formatos. Nao passam no digito verificador (falta ou sobra digito),
// entao contador de CPF nao acusa - mas continuam sendo o documento de uma pessoa, legivel.
// So valem COM rotulo: e o rotulo que diz que aquele numero e documento e nao valor nem data.
console.log('\n--- documento com digito faltando ou sobrando (OCR) ---');
for (const [txt, nome] of [
  ['portador do CPF 52.998.224-72 e', 'CPF com 10 digitos'],
  ['CPF sob o n. 52.998.224.725 e', 'CPF com 12 digitos'],
  ['CPF: 529.982.247-2 residente', 'digito verificador truncado'],
  ['CPF n. 529.98.247-25, brasileiro', 'grupo do meio com 2 digitos'],
  ['CPF 5299822 e RG', 'CPF com 7 digitos'],
  ['RG sob o n. 529982 expedido', 'RG com 6 digitos'],
]) ok(mascararPII(txt).includes('[removido]'), nome);

// Cauda orfa: o padrao consumiu parte do numero e deixou o resto colado na marca (Flores, Roseiras II)
ok(!/\d/.test(mascararPII('RG sob o n.º 12.345,678-9, residente').replace(/\D/g, '')),
  'nao sobra pedaco de documento colado no [removido]');
// CONTROLE da cauda: numero que vem depois da marca SEM separador nao e cauda, e nao pode sumir
ok(mascararPII('CPF: 529.982.247-25 Presidente 4 | Pagina 2').includes('Presidente 4'),
  'numeracao depois da marca (sem separador) fica intacta');
// O detector tem de acusar os MESMOS casos: era o `_temPII` dizendo false nesses 4 arquivos que
// deixava a ingestao aprovar a ata com o documento dentro.
ok(_temPII('portador do CPF sob o n. 529982247 25, residente') === true, 'detector ve o separador parcial');
ok(_temPII('RG: 529982.247-25 Secretaria') === true, 'detector ve o rotulado como RG');

// CONTROLES - o motivo de a ancora no rotulo existir. Mascarar demais destroi a ata.
console.log('\n--- controles: o que NAO pode ser mascarado ---');
const legit = [
  ['aprovada a previsao orcamentaria de R$ 101.893,87 para o exercicio', 'valor em reais'],
  ['conforme a Lei 4.591/64 e o art. 1.336 do Codigo Civil', 'numero de lei e de artigo'],
  ['o condominio, CNPJ 17.057.515/0001-20, representado', 'CNPJ do condominio (nao e pessoa)'],
  ['protocolo 123.456.789-11 do processo', 'shape de CPF com digito INVALIDO e sem rotulo'],
  ['saldo de R$ 1.234.567,89 em caixa', 'valor grande em reais'],
  // Estes tres entram em 09/08 junto com o afrouxamento do separador: sao o que o fix NAO pode comer.
  // O rotulo "CPF" perto de um numero que nao e CPF e o cenario de risco de afrouxar o separador.
  ['CPF/CNPJ: 17.057.515/0001-20 da administradora', 'CNPJ colado no rotulo CPF'],
  ['CPF nao informado; ver R$ 101.893,87 no balancete', 'valor em R$ logo depois da palavra CPF'],
  ['CPF nao consta. Lei 4.591/64, art. 1.336 do Codigo Civil', 'lei e artigo depois da palavra CPF'],
  // O risco que a VIRGULA abre: valor em R$ com 11 digitos (3-3-3-2) perto do rotulo. Precisaria
  // passar de cem milhoes, mas o controle fica escrito - se um dia colidir, este teste avisa.
  ['CPF a informar; obra de R$ 123.456.789,01 aprovada', 'valor de 9 digitos + centavos perto do rotulo'],
  // ⚠️ Controles do bloco acima: com o rotulo aceitando numero de tamanho irregular, o que impede
  // de comer dinheiro e a proibicao do "$" no meio, e de comer lei/data e o minimo de 6 digitos.
  ['CPF e valor: R$ 101.893,87 no balancete', 'valor em R$ COLADO no rotulo'],
  ['CPF nao consta; ver Lei 4.591 de 1964', 'numero de lei perto do rotulo'],
  ['CPF: ver ata de 15/03/2024 para detalhe', 'data perto do rotulo'],
  ['RG: [removido] Presidente 4 | Pagina 2', 'numeracao de pagina depois do rotulo ja mascarado'],
];
for (const [txt, rotulo] of legit) ok(mascararPII(txt) === txt, 'preserva ' + rotulo);

// O detector tem de enxergar exatamente o que o mascarador trata - senao a ingestao APROVA o que
// deveria abortar. Foi o que aconteceu: _temPII devolvia false nas 89 atas sujas.
ok(_temPII('portadora do CPF:' + QUEBRA + CPF_FICT) === true, 'detector ve o CPF na linha seguinte');
ok(_temPII('sob n. ' + CPF_FICT2) === true, 'detector ve o CPF sem rotulo');
for (const [txt, rotulo] of legit) ok(_temPII(txt) === false, 'detector NAO acusa ' + rotulo);

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
