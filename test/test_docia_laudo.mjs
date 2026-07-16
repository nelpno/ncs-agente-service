// test_docia_laudo.mjs — o verificador de evidências (puro, sem rede) + o que a Ana pode ver.
// Guard central do módulo: campo cuja âncora não existe na transcrição NÃO vira tick na tela.
import { verificarEvidencias, ancorada, provaValor, valorCorroborado, normAncora, resumirParaAgente, montarLaudo } from '../src/docia/laudo.mjs';
import { conferir } from '../src/docia/conferir.mjs';

let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

const FONTE = `=== PÁGINA 1 ===
LOCADOR: MARIA DE SOUZA, brasileira, portadora do RG nº 9689991 e CPF nº 111.444.777-35.
LOCATÁRIO: JOAO DA SILVA, brasileiro, portador da carteira de identidade
nacional nº 49.900.377-9, CPF nº 529.982.247/25.
O imóvel situado na Rua Teste, nº 100, apartamento 401, bloco 11 - Residencial Teste.
Este contrato vigorará pelo prazo de 12 (doze) meses, tendo início em 19/05/2026 e término previsto para o dia 19/05/2027.
Pagará o LOCATÁRIO ao LOCADOR o valor mensal de R$ 1.000,00 (hum mil reais), a título de aluguel e o valor mensal de R$ 248,00 (duzentos e quarenta e oito reais) a título de condomínio.
Assinatura acima de "MARIA DE SOUZA (locador)".`;
const F = normAncora(FONTE);

// ---------- ancorada(): a âncora foi COPIADA da fonte? ----------
ok(ancorada('LOCADOR: MARIA DE SOUZA', F) === true, 'âncora literal presente → ancorada');
ok(ancorada('LOCADOR: PEDRO ALVES', F) === false, 'âncora ausente → não ancorada');
ok(ancorada('SP', F) === false, 'âncora curta demais rejeitada (casaria por acaso)');
ok(ancorada('', F) === false, 'âncora vazia rejeitada');

// Achado do contrato REAL: o passo 1 transcreve com quebra de linha no meio da frase e o passo 2 cita
// numa linha só. Palavra é palavra — quebra de linha não pode derrubar citação verdadeira.
ok(ancorada('portador da carteira de identidade nacional nº 49.900.377-9', F) === true, 'quebra de linha da fonte não derruba citação verdadeira');

// Achado do contrato REAL: o modelo "conserta" a pontuação ao citar (o original traz CPF com "/").
// Tolerar pontuação mantém o guard (palavras têm que existir) sem gerar falso-PENDENTE em massa.
ok(ancorada('CPF nº 529.982.247-25', F) === true, 'pontuação "consertada" pelo modelo não derruba citação verdadeira');

// Achado do contrato REAL (custou 2 análises em cada 5): o passo 1 transcreve "nº" (U+00BA, que o
// Unicode classifica como LETRA) e o passo 2 cita "n°" (U+00B0, SÍMBOLO). Se a normalização tratar os
// dois de forma diferente, a âncora do locatário não casa e a PARTE INTEIRA do contrato cai calada.
ok(normAncora('CPF nº 414.990.298/45') === normAncora('CPF n° 414.990.298-45'), 'ordinal "nº" e grau "n°" normalizam igual');
ok(normAncora('N.º 100') === normAncora('nº 100'), 'variantes de "nº" normalizam igual');
ok(ancorada('portador da carteira de identidade nacional n° 49.900.377-9', F) === true, 'âncora com "n°" acha fonte escrita com "nº"');
ok(normAncora('Endereço, ação e coração') === 'endereco acao e coracao', 'acento de português vira ASCII (não some letra)');

// Achado do contrato REAL: o modelo COSTUROU dois trechos distantes numa frase que não existe no papel
// ("Pagará o LOCATÁRIO ao LOCADOR o valor mensal de R$ 248,00"). É fabricação plausível — tem que cair.
ok(ancorada('Pagará o LOCATÁRIO ao LOCADOR o valor mensal de R$ 248,00 (duzentos e quarenta e oito reais)', F) === false,
  'âncora costurada de pedaços distantes é rejeitada (a frase não existe no documento)');

// ---------- provaValor(): a âncora prova o VALOR que ela diz sustentar? ----------
ok(provaValor('11', 'apartamento 401, bloco 11 - Residencial Teste') === true, 'valor curto provado por âncora curta e literal');
ok(provaValor('12', 'apartamento 401, bloco 11 - Residencial Teste') === false, 'valor que não aparece na âncora não é provado');
ok(provaValor('529.982.247-25', 'CPF nº 529.982.247/25') === true, 'CPF confere ignorando pontuação (o real veio com "/")');
ok(provaValor('2027-05-19', 'término previsto para o dia 19/05/2027') === true, 'data ISO provada por DD/MM/AAAA na âncora');
ok(provaValor('2027-05-19', 'Araraquara, 19 de maio de 2027') === true, 'data ISO provada por data por extenso');
ok(provaValor('2030-01-01', 'término previsto para o dia 19/05/2027') === false, 'data inventada não é provada por âncora verdadeira');
ok(provaValor(null, 'qualquer coisa') === true, 'valor nulo não precisa de prova');

// ---------- valorCorroborado(): o valor está na fonte NO CONTEXTO em que foi citado? ----------
// ⚠️ ESTE é o caso que custou 2 análises em cada 5 no contrato REAL, medido em 5 rodadas:
// o passo 2 escreveu "portadorA" (feminino) onde o papel diz "portador" — contaminado pela linha do
// LOCADOR logo acima ("brasileira, portadora"). Um caractere, a ~60 do CPF. A regra antiga ("a âncora
// inteira tem que existir na fonte") derrubava o locatário INTEIRO — nome e CPF — e o laudo dizia
// "contrato não traz o CPF do locatário" num contrato que traz. Pendência fantasma ensina o aprovador
// a ignorar pendência: é dos piores defeitos possíveis neste módulo.
const ancoraComEscorregao = 'LOCATÁRIO: JOAO DA SILVA, brasileiro, portadora da carteira de identidade nacional nº 49.900.377-9, CPF nº 529.982.247-25';
ok(valorCorroborado('JOAO DA SILVA', ancoraComEscorregao, F) === true, 'escorregão de 1 letra LONGE do valor não derruba o nome');
ok(valorCorroborado('529.982.247-25', ancoraComEscorregao, F) === true, 'escorregão de 1 letra LONGE do valor não derruba o CPF');
ok(ancorada(ancoraComEscorregao, F) === false, '...e a âncora inteira de fato NÃO casa (era isso que derrubava tudo)');

// A janela continua pegando invenção: valor curto só passa se o CONTEXTO citado existir no papel.
ok(valorCorroborado('12', 'bloco 12', F) === false, 'bloco inventado não é corroborado (o papel diz bloco 11)');
ok(valorCorroborado('11', 'bloco 11', F) === true, 'bloco verdadeiro é corroborado pelo contexto local');
ok(valorCorroborado('vaga 12', 'com direito a uma vaga de garagem nº 12', F) === false, 'campo inventado não é corroborado');
ok(valorCorroborado('2027-05-19', 'término previsto para o dia 19/05/2027', F) === true, 'data verdadeira corroborada');
ok(valorCorroborado('2030-01-01', 'término previsto para o dia 30/01/2030', F) === false, 'data inventada com âncora inventada não é corroborada');

// ---------- o campo inventado CAI, o verdadeiro FICA ----------
const inventado = {
  tipo_documento: 'locacao_particular',
  campos: {
    // âncora completa: prova nome E CPF → os dois sobrevivem (é o que o modelo faz no contrato real)
    locador: { nome: 'MARIA DE SOUZA', cpf: '111.444.777-35', evidencia: 'LOCADOR: MARIA DE SOUZA, brasileira, portadora do RG nº 9689991 e CPF nº 111.444.777-35', pagina: 1 },
    // âncora CURTA mas literal e verdadeira → tem que sobreviver (a regra de comprimento derrubava isto)
    bloco: { valor: '11', evidencia: 'bloco 11', pagina: 1 },
    // âncora prova o nome, mas o modelo pendurou um CPF que ela não sustenta → cai SÓ o CPF
    locatario: { nome: 'JOAO DA SILVA', cpf: '529.982.247-25', evidencia: 'LOCATÁRIO: JOAO DA SILVA, brasileiro', pagina: 1 },
    // o modelo "deduziu" uma garagem que não está no papel — e escreveu uma evidência plausível
    vaga: { valor: 'vaga 12', evidencia: 'com direito a uma vaga de garagem nº 12', pagina: 1 },
    // paráfrase: o dado é verdadeiro, mas a âncora não é literal → cai (falso-PENDENTE, o lado barato)
    vigencia: { inicio: '2026-05-19', fim: '2027-05-19', evidencia: 'o contrato vale por doze meses a partir de maio', pagina: 1 },
  },
  assinaturas: [
    { rotulo: 'locador', nome_sob_assinatura: 'MARIA DE SOUZA', presente: true, pagina: 1, evidencia: 'Assinatura acima de "MARIA DE SOUZA (locador)"' },
    { rotulo: 'locatario', nome_sob_assinatura: 'JOAO DA SILVA', presente: true, pagina: 1, evidencia: 'Assinatura acima de "JOAO DA SILVA (locatário)"' }, // NÃO está na fonte
  ],
  testemunhas: [],
};
const { extracao: limpa, descartados } = verificarEvidencias(inventado, FONTE);

ok(limpa.campos.locador.nome === 'MARIA DE SOUZA', 'campo ancorado sobrevive');
ok(limpa.campos.locador.cpf === '111.444.777-35', 'CPF provado pela mesma âncora sobrevive');
ok(limpa.campos.bloco.valor === '11', 'âncora curta, literal e verdadeira SOBREVIVE (comprimento não prova nada)');
ok(limpa.campos.locatario.nome === 'JOAO DA SILVA', 'sub-valor provado sobrevive...');
ok(limpa.campos.locatario.cpf === null, '...e o sub-valor não provado pela âncora cai sozinho');
ok(limpa.campos.vaga.valor === null, 'campo inventado é zerado');
ok(limpa.campos.vigencia.fim === null, 'campo com âncora parafraseada é zerado (na dúvida, pende)');
ok(limpa.campos.vaga.evidencia === '', 'campo derrubado perde a evidência (não fica tick órfão)');
ok('vaga' in limpa.campos, 'a chave permanece: conferir trata ausência como pendente, nunca como ok');
ok(limpa.assinaturas.length === 1, 'assinatura alegada sem evidência é removida');
ok(limpa.assinaturas[0].rotulo === 'locador', 'a assinatura que existe de fato permanece');
ok(descartados.length === 5, `tudo que caiu vira registro de auditoria (${descartados.length})`);
ok(descartados.every((d) => d.onde && d.motivo), 'auditoria diz ONDE e POR QUÊ');
ok(descartados.some((d) => d.motivo === 'valor_nao_corroborado'), 'auditoria distingue "âncora falsa" de "valor não corroborado"');

// não muta a entrada
ok(inventado.campos.vaga.valor === 'vaga 12', 'verificarEvidencias não muta a extração original');

// ---------- campo vazio declarado NÃO é alegação de fato ----------
const comVazio = { campos: {}, assinaturas: [{ rotulo: 'testemunha', presente: false, evidencia: 'campo VAZIO' }], testemunhas: [] };
ok(verificarEvidencias(comVazio, FONTE).extracao.assinaturas.length === 1, 'campo de assinatura VAZIO sobrevive (é observação, não alegação)');

// ---------- o verificador REALMENTE muda o veredito ----------
const ctx = { hoje: new Date('2026-07-15T12:00:00Z'), erp: null };
const semVerificar = conferir({ ...inventado, tipo_documento: 'locacao_particular', paginas: [{ n: 1, legibilidade: 'ok' }] }, ctx);
const comVerificar = conferir({ ...limpa, tipo_documento: 'locacao_particular', paginas: [{ n: 1, legibilidade: 'ok' }] }, ctx);
ok(semVerificar.conferencias.find((c) => c.item === 'assinatura_locatario').status === 'ok', 'sem verificador: assinatura inventada passaria como ok');
ok(comVerificar.conferencias.find((c) => c.item === 'assinatura_locatario').status === 'pendente', 'com verificador: vira pendente (o humano vai olhar)');
ok(comVerificar.confianca < semVerificar.confianca, 'o verificador derruba a confiança em vez de inflá-la');

// ---------- o texto do contrato NUNCA vai para o contexto da Ana (anti-injeção §6.4) ----------
const laudo = montarLaudo({
  id: 'uuid-1', extracao: limpa, veredito: comVerificar, paginas: [{ n: 1, legibilidade: 'ok' }],
  arquivos: [{ storage_path: 'contratos/2026/07/x.pdf' }], origem: { canal: 'whatsapp' }, descartados, modelo: 'gemini-2.5-flash',
});
const resumo = resumirParaAgente(laudo);
const serial = JSON.stringify(resumo);
ok(!/LOCADOR:|vigorará|Rua Teste|brasileira/i.test(serial), 'o resumo para a Ana não carrega o texto do contrato');
ok(!/storage_path|contratos\//.test(serial), 'o resumo não expõe o caminho do arquivo');
ok(resumo.parecer === comVerificar.parecer, 'o resumo leva o parecer');
ok(Array.isArray(resumo.pendencias), 'o resumo leva as pendências (é o que a Ana devolve ao morador)');
ok('responsavel_taxa_sugerido' in resumo, 'o resumo leva a SUGESTÃO de quem paga a taxa (a Ana confirma, não decide)');
ok(resumo.responsavel_taxa_sugerido === null, 'sem cláusula ancorada → null → a Ana pergunta do zero (como hoje)');

console.log(falhas === 0 ? '\n✅ todos os checks passaram' : `\n❌ ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
