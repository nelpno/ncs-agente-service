// extrair.mjs — a percepção do DocIA. DOIS passos, de propósito.
//
//   passo 1 — lerDossie()    : VISÃO. Transcreve o papel e relata FATOS VISUAIS (assinaturas, carimbos,
//                              campos vazios, legibilidade). Não julga, não resume, não deduz.
//   passo 2 — extrairCampos(): TEXTO. Estrutura a transcrição do passo 1 em campos, cada um com uma
//                              ÂNCORA (trecho literal). Não vê o documento — só o texto do passo 1.
//
// Por que dois passos e não um só:
//  1. VERIFICABILIDADE. O contrato real do cliente é 100% escaneado (4 páginas, zero camada de texto):
//     não existe "texto-fonte" para fatiar verbatim, como fazemos nos regimentos. A transcrição do passo 1
//     É a fonte. Um campo inventado no passo 2 não acha âncora nela e cai (laudo.mjs) — o passo 2 não
//     consegue inventar e confirmar a si mesmo, porque não enxerga o papel.
//  2. ANTI-INJEÇÃO. Um contrato pode trazer "ignore as instruções anteriores". Os dois passos rodam SEM
//     tools e com saída estruturada, e a Ana só recebe o laudo resumido — o texto do contrato nunca entra
//     no contexto do agente.
//  3. VISUAL. "Assinou no campo certo?" é fato de imagem, não de texto. O passo 1 reporta o nome sob cada
//     assinatura; comparar é trabalho de código (conferir.mjs).
//
// Padrão de chamada herdado de estagiario/src/visao.mjs (inline_data, temperature 0, thinkingBudget 0 —
// o thinking come o orçamento de saída e trunca a extração de forma imprevisível).

// A chave é lida em tempo de CHAMADA (não no import, como faz o visao.mjs): assim o teste injeta
// env sem depender da ordem de import — a mordida clássica do config.mjs deste repo.
//
// ⚠️ CHAVE PRÓPRIA (DOCIA_GEMINI_KEY), com GEMINI_API_KEY só como fallback de conveniência.
// Medido nesta sessão: ~20 análises seguidas estouraram a cota (HTTP 429 RESOURCE_EXHAUSTED). E a
// GEMINI_API_KEY não é só do multimodal — é a chave do FALLBACK cross-provider do llm.mjs, que segura
// Ana e Estagiário quando a OpenAI cai (incidente de 07/07: conta sem crédito → 429 → os dois fora).
// Compartilhar a cota faz uma fila de contratos derrubar a rede de segurança dos DOIS bots, calada.
// Rajada de análise é justamente o caso de uso (o morador manda 4 fotos), então isolar não é luxo.
const GEMINI_KEY = () => process.env.DOCIA_GEMINI_KEY || process.env.GEMINI_API_KEY || '';

// Modelo por PASSO, separado de propósito — os dois passos têm exigências diferentes:
//  · passo 1 (visão) é o crítico: transcrever manuscrito e dizer QUAL nome está sob cada assinatura.
//    É onde um modelo menor machuca mais, e é o insumo de tudo que vem depois.
//  · passo 2 (texto→JSON) é estruturação mecânica: candidato natural a modelo menor/mais barato.
// Qual usar em cada um é decisão de BAKE-OFF MEDIDO (taxa de acerto em N rodadas contra os contratos
// reais), não de palpite — e a régua já existe: test_docia_real.mjs rodado 5x+. Não fixe por intuição.
const MODEL_VISAO = () => process.env.DOCIA_VISION_MODEL || process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';
const MODEL_TEXTO = () => process.env.DOCIA_TEXT_MODEL || process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';
const TIMEOUT_MS = () => parseInt(process.env.DOCIA_TIMEOUT_MS || '120000', 10);
const MAX_BYTES = 18 * 1024 * 1024; // mesmo teto do adapter/visao
const TIPOS_OK = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

const PROMPT_LEITURA = `Você é um leitor de documentos de uma administradora de condomínios. Transcreva ESTE documento com fidelidade absoluta. NÃO interprete, NÃO julgue, NÃO opine, NÃO resuma, NÃO complete o que falta.

Para CADA página, devolva neste formato exato:

=== PÁGINA <n> ===
[LEGIBILIDADE]: ok | parcial | ilegivel
[TEXTO]:
<transcrição literal do texto impresso, na ordem em que aparece>
[MANUSCRITO]:
<transcrição literal de anotações à mão, ou: nenhum>
[VISUAL]:
<fatos visuais objetivos, um por linha. Obrigatório relatar:
 - cada ASSINATURA: onde está e QUAL nome/rótulo aparece embaixo ou ao lado dela (ex.: Assinatura acima de "FULANO (locador)")
 - campos de assinatura VAZIOS (diga explicitamente que está vazio)
 - rubricas, carimbos, selos de cartório, QR code, marca de plataforma de assinatura eletrônica
 - rasuras ou trechos riscados
 Se não houver nada disso, escreva: nenhum>

Regras absolutas:
- Números (CPF, RG, datas, valores) EXATAMENTE como estão no papel, sem corrigir e sem reformatar. Se o CPF vier com pontuação errada, copie a pontuação errada.
- O que não estiver no papel, não escreva. Nunca deduza.
- Se a página estiver ilegível, marque [LEGIBILIDADE]: ilegivel e não invente o conteúdo.`;

const PROMPT_CAMPOS = `Você extrai dados de um contrato imobiliário JÁ TRANSCRITO. Você NÃO vê o documento: sua única fonte é a TRANSCRIÇÃO abaixo.

TIPO DO DOCUMENTO — o que separa um do outro (não chute; medido: sem esta definição o modelo classifica
contrato particular como "imobiliaria" e o checklist passa a cobrar dado de imobiliária que não existe):
- "locacao_imobiliaria": uma IMOBILIÁRIA/administradora aparece como parte, intermediária ou
  administradora da locação (razão social, CRECI ou CNPJ dela no contrato).
- "locacao_particular": locação direta entre o proprietário e o locatário, sem imobiliária. É o caso de
  "Instrumento Particular de Contrato de Locação". Ter reconhecimento de firma em cartório NÃO faz um
  contrato ser "imobiliaria".
- "outro": não é contrato de locação (compra e venda, matrícula, escritura...).

Devolva SOMENTE um JSON válido, sem markdown e sem comentários, neste formato:

{
  "tipo_documento": "locacao_imobiliaria" | "locacao_particular" | "outro",
  "campos": {
    "condominio":   {"valor": string|null, "evidencia": string, "pagina": number|null},
    "unidade":      {"valor": string|null, "evidencia": string, "pagina": number|null},
    "bloco":        {"valor": string|null, "evidencia": string, "pagina": number|null},
    "locador":      {"nome": string|null, "cpf": string|null, "evidencia": string, "pagina": number|null},
    "locatario":    {"nome": string|null, "cpf": string|null, "data_nascimento": "AAAA-MM-DD"|null, "evidencia": string, "pagina": number|null},
    "data_contrato":{"valor": "AAAA-MM-DD"|null, "evidencia": string, "pagina": number|null},
    "vigencia":     {"inicio": "AAAA-MM-DD"|null, "fim": "AAAA-MM-DD"|null, "evidencia": string, "pagina": number|null},
    "imobiliaria":  {"nome": string|null, "cnpj": string|null, "evidencia": string, "pagina": number|null},
    "responsavel_taxa": {"valor": "proprietario"|"inquilino"|null, "evidencia": string, "pagina": number|null}
  },
  "assinaturas": [
    {"rotulo": "locador"|"locatario"|"testemunha"|"outro", "nome_sob_assinatura": string|null, "presente": true|false, "pagina": number|null, "evidencia": string}
  ],
  "testemunhas": [{"nome": string|null, "presente": true|false, "evidencia": string}],
  "paginas_completas": true|false|null,
  "paginas_completas_evidencia": string
}

REGRAS INEGOCIÁVEIS:
1. "evidencia" tem que ser um trecho COPIADO LETRA POR LETRA da transcrição (mínimo 12 caracteres). Nunca parafraseie, nunca resuma, nunca junte pedaços distantes. É por ela que conferimos você.
2. Não achou o dado na transcrição? valor: null e evidencia: "". NUNCA deduza, NUNCA preencha por plausibilidade.
3. Datas em AAAA-MM-DD. CPF exatamente como está na transcrição (não conserte a pontuação).
4. "assinaturas": use o bloco [VISUAL]. "presente": false para campo de assinatura vazio. "nome_sob_assinatura" = o nome que aparece sob/ao lado da assinatura, mesmo que seja diferente da parte.
5. "responsavel_taxa" — leia com cuidado, é a única cláusula financeira que interessa e ela engana:
   - o inquilino paga a taxa AO LOCADOR/proprietário (ex.: "pagará ao LOCADOR ... a título de condomínio")
     → quem responde perante o condomínio segue sendo o PROPRIETÁRIO → "proprietario".
   - o inquilino paga a taxa DIRETAMENTE ao condomínio/administradora (boleto em nome dele) → "inquilino".
   - qualquer dúvida, silêncio do contrato ou redação ambígua → null. Chutar aqui manda boleto para a
     pessoa errada ou emite dois. Na dúvida, null.
6. Não interprete valor de aluguel, multa, caução ou forma de pagamento. Não opine sobre legalidade.

TRANSCRIÇÃO:
`;

const erro = (motivo, extra = {}) => ({ ok: false, motivo, ...extra });

async function chamarGemini(model, parts, { json = false, fetchImpl = fetch, maxTokens = 8192 } = {}) {
  const key = GEMINI_KEY();
  if (!key) return erro('sem_gemini');
  const body = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: maxTokens,
      thinkingConfig: { thinkingBudget: 0 },
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  try {
    const r = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS()),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return erro('http', { status: r.status, detalhe: JSON.stringify(j).slice(0, 300) });
    const cand = j?.candidates?.[0];
    const txt = (cand?.content?.parts || []).map((p) => p.text).filter(Boolean).join('').trim();
    if (!txt) return erro('vazio', { finish: cand?.finishReason });
    return { ok: true, txt, finish: cand?.finishReason, uso: j?.usageMetadata || {} };
  } catch (e) {
    return erro('erro', { detalhe: e.message });
  }
}

/** Uma peça do dossiê: { mime, buf } (foto ou PDF). Valida antes de gastar chamada. */
export function validarPeca(peca) {
  if (!peca?.buf?.length) return erro('formato');
  if (!TIPOS_OK.has(String(peca.mime || '').toLowerCase())) return erro('tipo', { mime: peca.mime });
  if (peca.buf.length > MAX_BYTES) return erro('grande', { bytes: peca.buf.length });
  return { ok: true };
}

/** Quebra a transcrição do passo 1 em páginas estruturadas. Puro — testável sem rede. */
export function parsearLeitura(txt, offset = 0) {
  const paginas = [];
  const blocos = String(txt || '').split(/^=== P[ÁA]GINA\s+(\d+)\s*===\s*$/gim);
  for (let i = 1; i < blocos.length; i += 2) {
    const corpo = blocos[i + 1] || '';
    const secao = (nome) => {
      const m = corpo.match(new RegExp(`\\[${nome}\\]:\\s*([\\s\\S]*?)(?=\\n\\[(?:LEGIBILIDADE|TEXTO|MANUSCRITO|VISUAL)\\]:|$)`, 'i'));
      return (m?.[1] || '').trim();
    };
    const leg = secao('LEGIBILIDADE').toLowerCase();
    paginas.push({
      n: offset + Number(blocos[i]),
      legibilidade: /ileg/.test(leg) ? 'ilegivel' : /parcial/.test(leg) ? 'parcial' : 'ok',
      texto: secao('TEXTO'),
      manuscrito: /^nenhum\.?$/i.test(secao('MANUSCRITO')) ? '' : secao('MANUSCRITO'),
      visual: /^nenhum\.?$/i.test(secao('VISUAL')) ? '' : secao('VISUAL'),
    });
  }
  return paginas;
}

/** Texto único contra o qual as âncoras do passo 2 são conferidas (laudo.mjs). */
export const montarFonte = (paginas) => (paginas || [])
  .map((p) => `=== PÁGINA ${p.n} ===\n${p.texto}\n${p.manuscrito}\n${p.visual}`).join('\n\n');

/**
 * PASSO 1 — visão. Lê as peças do dossiê (as "4 fotos seguidas" ou o PDF).
 * @param {Array<{mime:string,buf:Buffer}>} pecas
 * @returns {Promise<{ok:boolean, paginas?:Array, fonte?:string, motivo?:string}>}
 */
export async function lerDossie(pecas, { fetchImpl = fetch } = {}) {
  const lista = Array.isArray(pecas) ? pecas : [pecas];
  if (!lista.length) return erro('formato');
  const paginas = [];
  let uso = { in: 0, out: 0 };
  for (const peca of lista) {
    const v = validarPeca(peca);
    if (!v.ok) return v;
    const r = await chamarGemini(MODEL_VISAO(), [
      { text: PROMPT_LEITURA },
      { inline_data: { mime_type: peca.mime, data: peca.buf.toString('base64') } },
    ], { fetchImpl });
    if (!r.ok) return r;
    uso = { in: uso.in + (r.uso.promptTokenCount || 0), out: uso.out + (r.uso.candidatesTokenCount || 0) };
    const pgs = parsearLeitura(r.txt, paginas.length);
    // Sem marcador de página (modelo fugiu do formato): trata a peça inteira como 1 página, mas não perde o texto.
    paginas.push(...(pgs.length ? pgs : [{ n: paginas.length + 1, legibilidade: 'ok', texto: r.txt, manuscrito: '', visual: '' }]));
  }
  if (!paginas.length) return erro('vazio');
  return { ok: true, paginas, fonte: montarFonte(paginas), uso };
}

/**
 * PASSO 2 — texto. Estrutura a transcrição em campos com âncora. NÃO vê o documento.
 * @param {string} fonte  saída de lerDossie().fonte
 */
export async function extrairCampos(fonte, { fetchImpl = fetch } = {}) {
  if (!String(fonte || '').trim()) return erro('vazio');
  const r = await chamarGemini(MODEL_TEXTO(), [{ text: PROMPT_CAMPOS + fonte }], { json: true, fetchImpl });
  if (!r.ok) return r;
  try {
    const dados = JSON.parse(r.txt);
    return { ok: true, extracao: dados, uso: r.uso };
  } catch {
    // Parse tolerante: com JSON estrito + thinking desligado é raro, mas nunca derruba a análise.
    const m = r.txt.match(/\{[\s\S]*\}/);
    if (m) { try { return { ok: true, extracao: JSON.parse(m[0]), uso: r.uso }; } catch { /* cai abaixo */ } }
    return erro('json_invalido', { amostra: r.txt.slice(0, 200) });
  }
}
