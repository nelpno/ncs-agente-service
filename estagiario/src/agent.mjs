// agent.mjs — o Estagiário: loop (prompt + tools). Reusa o LLM e o RAG de regimento da Ana;
// adiciona as tools de documento (motor determinístico). Persona e porta de acesso SÃO separadas.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chat } from "../../src/llm.mjs";        // REUSO: mesmo cliente LLM da Ana
import { config } from "../../src/config.mjs";   // p/ saber o modelo (log de custo por turno)
import * as REG from "../../src/regimento.mjs";  // REUSO: achar o artigo (isolado por condo)
import * as BG from "../../src/base_geral.mjs";  // REUSO: base institucional (Gruvi, links, responsabilidades) — dúvida de morador
import * as MUD from "../../src/mudanca.mjs";    // REUSO: regra de mudança por condo — dúvida de morador
import * as PORT from "../../src/portaria.mjs";  // REUSO: sistema/tipo de portaria por condo — dúvida de morador
import * as GRUVI from "../../src/gruvi.mjs";    // REUSO: vídeo tutorial do app Gruvi — dúvida de morador
import * as TAXA from "../../src/taxa.mjs";      // REUSO: o que é incluso na taxa (gás/água/internet) por condo — dúvida de morador
import * as VTAXA from "./valor_taxa.mjs";       // NOVO: VALOR em R$ da taxa por unidade (≠ TAXA, que é o que está incluso)
import * as DOC from "./documentos.mjs";                         // NOVO: motor de geração de PDF
import * as REL from "./relatorio.mjs";                          // NOVO: relatório de prestação de contas

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// SYSTEM_PROMPT_PATH permite A/B de prompt sem tocar o default (igual ao loop da Ana).
const SYSTEM_PROMPT = fs.readFileSync(process.env.SYSTEM_PROMPT_PATH || path.join(__dirname, "..", "spec", "system-prompt.md"), "utf8");

const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
function hojeExtenso() { const d = new Date(); return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`; }

const TOOLS = [
  { type: "function", function: { name: "listar_infracoes", description: "Lista o cardápio FECHADO de infrações de um condomínio (id, título, palavras-chave). Use ANTES de gerar um documento para escolher o infracao_id correto a partir do relato. Nunca invente um id fora desta lista.", parameters: { type: "object", properties: { condominio: { type: "string", description: "Slug/nome do condomínio (ex.: vancouver, lume)." } }, required: ["condominio"] } } },
  { type: "function", function: { name: "buscar_morador", description: "Busca o morador de uma unidade no Superlógica (nome + se é proprietário/inquilino). Use quando o usuário der o condomínio + número do apartamento, para preencher o destinatário SEM o usuário digitar o nome. Confirme o nome retornado antes de gerar. AJUDA, não autoriza: se voltar encontrado:false, NÃO insista na busca — siga com o que a equipe informou e omita o que ninguém souber.", parameters: { type: "object", properties: { condominio: { type: "string" }, unidade: { type: "string", description: "Número do apartamento, ex.: '132'." }, bloco: { type: "string", description: "Bloco/torre, se houver, ex.: '01'." } }, required: ["condominio", "unidade"] } } },
  { type: "function", function: { name: "consultar_regimento", description: "Consulta o Regimento Interno / Convenção do condomínio para responder dúvidas sobre regras (animais, barulho, mudança, obras, garagem, multas etc.). Retorna trechos com a fonte (seção/artigo). Responda SEMPRE citando a fonte; se encontrou:false, não invente — ofereça encaminhar.", parameters: { type: "object", properties: { condominio: { type: "string" }, pergunta: { type: "string" } }, required: ["pergunta"] } } },
  { type: "function", function: { name: "gerar_documento", description: "Gera a notificação ou multa (uma MINUTA para o síndico assinar) — por padrão em WORD EDITÁVEL (.doc), para a equipe apagar os artigos que não se aplicam e complementar o relato antes de finalizar; gere em PDF só se pedirem a versão final. Só chame com TODOS os campos confirmados. O texto do artigo, a convenção e o cabeçalho são preenchidos pelo motor — você só fornece a classificação e o relato.", parameters: { type: "object", properties: {
      condominio: { type: "string" },
      tipo: { type: "string", enum: ["notificacao", "multa"] },
      formato: { type: "string", enum: ["word", "pdf"], description: "Formato de saída. Padrão 'word' (editável) — a equipe apara o texto do regimento e ajusta o relato. Use 'pdf' só quando pedirem a versão final não-editável." },
      nivel_reincidencia: { type: "integer", description: "1, 2, 3… (só para multa)." },
      infracao_id: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" }, maxItems: 3 }], description: "Um id retornado por listar_infracoes — ou uma LISTA de ids quando pedirem mais de uma infração no MESMO documento (todas entram no enquadramento; não escolha uma só)." },
      destinatario: { type: "object", properties: {
        nome: { type: "string" }, genero: { type: "string", enum: ["F", "M"] },
        papel: { type: "string", enum: ["proprietario", "morador", "inquilino", "responsavel"], description: "Só informe se SOUBER (veio de buscar_morador ou a equipe disse). Não sabe? OMITA — o documento sai com o termo neutro 'responsável'. Nunca chute: afirmar 'proprietário'/'inquilino' errado é dado falso num documento que o síndico assina." },
        apartamento: { type: "string", description: "Ex.: '132 01'." },
      }, required: ["nome", "genero", "apartamento"] },
      relato: { type: "string", description: "O parágrafo da ocorrência, redigido por você em tom institucional, só com os fatos informados." },
      destaques: { type: "array", items: { type: "string" }, description: "Opcional — só quando pedirem negrito/destaque. Trechos copiados LITERALMENTE do relato (data, horário, o fato central) para saírem em negrito. Destinatário, artigo e valor da multa já saem em negrito sozinhos. Nunca escreva ** ou marcação dentro do relato." },
      penalidade: { type: "object", properties: { taxas: { type: "integer" }, mes_boleto: { type: "string", description: "Ex.: 'novembro de 2025'." } }, description: "Obrigatório para tipo=multa." },
      data_documento: { type: "string", description: "Ex.: '13 de junho de 2026'. Se não informado, use hoje." },
    }, required: ["condominio", "tipo", "infracao_id", "destinatario", "relato", "data_documento"] } } },
  { type: "function", function: { name: "gerar_cnd", description: "Gera a DECLARAÇÃO DE QUITAÇÃO DE DÉBITOS (CND) de uma unidade, via INFORMATIVA (sem assinatura). Use em 'CND', 'nada consta', 'declaração/comprovante de quitação'. Informe condomínio + unidade (e bloco, se houver). SÓ gera para unidade 100% em dia — se voltar ok:false (motivo inadimplente / no_juridico / garantidora_ou_cego / indisponivel), explique e NÃO afirme quitação.", parameters: { type: "object", properties: { condominio: { type: "string" }, unidade: { type: "string", description: "Número do apartamento, ex.: '132'." }, bloco: { type: "string", description: "Bloco/torre, se houver." }, tipo: { type: "string", enum: ["informativo"], description: "Por ora só 'informativo'." } }, required: ["condominio", "unidade"] } } },
  { type: "function", function: { name: "gerar_relatorio_prestacao_contas", description: "RELATÓRIO de prestação de contas de UM MÊS: receitas x despesas por categoria, previsto x realizado (com gráfico quando há previsão), caixa, inadimplência e resumo executivo. Use em 'prestação de contas', 'relatório/fechamento do mês', 'como fechou o mês' de UM mês. Para um INTERVALO de meses use gerar_relatorio_periodo. Informe o condomínio; mês/ano opcionais — mês omitido = último mês fechado.", parameters: { type: "object", properties: { condominio: { type: "string" }, mes: { type: "string", description: "Mês de referência: número 1-12 ou o nome (ex.: 'junho'). Opcional — se omitido, usa o último mês fechado." }, ano: { type: "integer", description: "Ano de referência (ex.: 2026). Opcional." }, formato: { type: "string", enum: ["pdf", "word"], description: "Formato de saída. Opcional — padrão 'pdf'. Use 'word' se o usuário quiser um documento editável (para ajustar/complementar o texto)." } }, required: ["condominio"] } } },
  { type: "function", function: { name: "gerar_relatorio_periodo", description: "RELATÓRIO consolidado de um INTERVALO de meses (equivale ao acumulado da Superlógica): totais e média mensal, tabela mês a mês, gráficos de evolução e de previsto x realizado, categorias acumuladas, caixa e inadimplência. Use em 'de janeiro a maio', 'primeiro semestre', 'trimestre', 'acumulado do ano'. Informe o condomínio, o mês inicial e o mês final; ano opcional (padrão: corrente).", parameters: { type: "object", properties: { condominio: { type: "string" }, mes_inicio: { type: "string", description: "Mês inicial do intervalo: número 1-12 ou nome (ex.: 'janeiro')." }, mes_fim: { type: "string", description: "Mês final do intervalo: número 1-12 ou nome (ex.: 'maio')." }, ano: { type: "integer", description: "Ano de referência (ex.: 2026). Opcional — padrão: ano corrente." }, formato: { type: "string", enum: ["pdf", "word"], description: "Formato de saída. Opcional — padrão 'pdf'. Use 'word' para documento editável." } }, required: ["condominio", "mes_inicio", "mes_fim"] } } },
  { type: "function", function: { name: "analisar_condominio", description: "ANÁLISE com RECOMENDAÇÕES consultivas sobre a saúde financeira no período: resultado equilibrado ou deficitário, avaliar reajuste da taxa ou manter, categorias de despesa que pesam, inadimplência e tendência. Use em 'recomendação para este condomínio', 'análise financeira', 'devo reajustar a taxa?', 'onde dá para cortar'. São SUGESTÕES de apoio — a decisão é do síndico/assembleia. Sem período = do início do ano ao último mês fechado.", parameters: { type: "object", properties: { condominio: { type: "string" }, mes_inicio: { type: "string", description: "Mês inicial (opcional)." }, mes_fim: { type: "string", description: "Mês final (opcional)." }, ano: { type: "integer", description: "Ano (opcional)." }, formato: { type: "string", enum: ["pdf", "word"], description: "Formato de saída (opcional, padrão 'pdf')." } }, required: ["condominio"] } } },
  // --- Dúvidas de morador (consulta rápida para a equipe) — mesmas fontes que o agente de clientes (a Ana). READ-ONLY. ---
  { type: "function", function: { name: "consultar_base_geral", description: "Consulta a BASE INSTITUCIONAL do NCS (igual para todos os condomínios) para uma dúvida de MORADOR: como usar o app Gruvi / Área do Condômino e 1º acesso, LINKS de formulários/canais (mudança, cadastro de inquilino/dependente, titularidade, negociação, abertura de chamado, CND), responsabilidade adm x síndico, Clube NCS, dados da empresa. Use em 'como o morador faz X', 'qual o link de X', 'como pego o boleto'. Retorna {encontrou, trechos:[{fonte, texto}]}; passe os LINKS oficiais que vierem. Regras de UM condomínio específico = consultar_regimento.", parameters: { type: "object", properties: { pergunta: { type: "string", description: "A dúvida do morador, em linguagem natural." } }, required: ["pergunta"] } } },
  { type: "function", function: { name: "consultar_regra_mudanca", description: "REGRA DE MUDANÇA de um condomínio (horário, antecedência, 1 por dia, sem taxa, como agendar). Informe o condomínio. Retorna { encontrou, condominio, horario, regras_condominio, regras_gerais }. ⚠️ NUNCA oriente o morador a avisar/contatar portaria, zeladoria ou síndico, nem cadastrar em sistema (Shielder etc.) — quem faz isso é a NCS; o morador só preenche o formulário e aguarda o termo. Regras de convivência (animais, barulho, obras) = consultar_regimento.", parameters: { type: "object", properties: { condominio: { type: "string" } }, required: ["condominio"] } } },
  { type: "function", function: { name: "consultar_sistema_portaria", description: "PORTARIA de um condomínio: se é HUMANA, VIRTUAL ou HÍBRIDA (campo tipo_portaria) e qual o app/sistema (Shielder, GatWay, Synnus, Alarm System, TW Virtua). Use em 'a portaria do Studio Five é humana ou remota?', 'qual o app de portaria?'. Informe o condomínio. Retorna { encontrou, condominio, sistema, tipo_portaria, tipo_conhecido, sistema_conhecido, ... }. 'Humana ou virtual?' responde-se SÓ pelo tipo_portaria — o app NÃO define isso. tipo_conhecido/sistema_conhecido/encontrou=false → não invente. Boleto nunca é pela portaria, é pelo app Gruvi.", parameters: { type: "object", properties: { condominio: { type: "string" } }, required: ["condominio"] } } },
  { type: "function", function: { name: "consultar_video_app", description: "Acha o VÍDEO tutorial oficial do app Gruvi (1º acesso/login, cadastrar facial, validar documento, pegar boleto, reservar área, cadastrar veículo, liberar visitante/prestador, ver comunicados/documentos etc.). Use em 'como o morador faz X no app', 'como acesso o Gruvi', 'como pego o boleto no app'. Passe o assunto em texto livre. Retorna { encontrou, titulo, url } — se encontrou, passe a URL pra equipe repassar.", parameters: { type: "object", properties: { assunto: { type: "string", description: "O que a pessoa quer fazer no app, em texto livre (ex.: 'pegar boleto', 'cadastrar facial')." } }, required: ["assunto"] } } },
  { type: "function", function: { name: "consultar_taxa_condominial", description: "O que é INCLUSO NA TAXA CONDOMINIAL (gás, água, internet) de um condomínio. Use em 'o gás está incluso na taxa?', 'a água é inclusa?', 'quais provedores de internet o condomínio libera?'. Informe o condomínio. Retorna { encontrou, condominio, itens:{ gas:{incluso, empresa}, agua:{incluso}, internet:[...] }, resumo }. encontrou=false → não invente, oriente confirmar com a administração.", parameters: { type: "object", properties: { condominio: { type: "string" } }, required: ["condominio"] } } },
  { type: "function", function: { name: "consultar_valor_taxa", description: "VALOR em R$ da taxa condominial de UMA unidade, decomposto (Taxa Condomínio, Taxa Extra, Fundo de Reserva...). Use em 'qual a taxa do Lume?', 'quanto paga o apto 203?'. NÃO confunda com consultar_taxa_condominial (essa diz o que está INCLUSO: gás/água/internet). ⚠️ EXIGE a unidade: o mesmo condomínio tem valores diferentes por fração ideal (metragem) — se a pessoa não disser a unidade, PERGUNTE de qual é, explicando o motivo; nunca responda um valor 'do condomínio'. Retorna { ok, condominio, unidade, vencimento, total_formatado, rubricas:[{descricao, valor_formatado}], encargos:[...] }. ok=false: informe_unidade=pergunte a unidade; ambiguo=confirme qual (veja opcoes); sem_boleto/composicao_indisponivel/composicao_nao_confere=NÃO invente valor, diga que precisa conferir no Superlógica. encargos = juros/multa por atraso, fora da taxa.", parameters: { type: "object", properties: { condominio: { type: "string", description: "Nome do condomínio (ex.: Lume)." }, unidade: { type: "string", description: "Apartamento/unidade como a pessoa falou (ex.: '203', 'apto 101')." }, bloco: { type: "string", description: "Bloco/torre, se houver (ex.: '1')." } }, required: ["condominio", "unidade"] } } },
];

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

async function runTool(name, args, ctx) {
  switch (name) {
    case "listar_infracoes": return DOC.listar_infracoes(args);
    case "buscar_morador": return await DOC.buscar_morador(args);
    case "consultar_regimento": return REG.consultar_regimento(args);
    case "consultar_base_geral": return BG.consultar_base_geral(args);
    case "consultar_regra_mudanca": return MUD.consultar_regra_mudanca(args);
    case "consultar_sistema_portaria": return PORT.consultar_sistema_portaria(args);
    case "consultar_video_app": return GRUVI.buscar_video(args.assunto);
    case "consultar_taxa_condominial": return TAXA.consultar_taxa_condominial(args);
    case "consultar_valor_taxa": return await VTAXA.consultar_valor_taxa(args);
    case "gerar_documento": {
      const out = await DOC.gerar_documento(args);
      if (out.ok) ctx.lastDoc = { url: out.url, arquivo: out.arquivo, titulo: out.titulo };
      return out;
    }
    case "gerar_cnd": {
      const out = await DOC.gerar_cnd(args);
      if (out.ok) ctx.lastDoc = { url: out.url, arquivo: out.arquivo, titulo: out.titulo };
      return out;
    }
    case "gerar_relatorio_prestacao_contas": {
      const out = await REL.gerar_relatorio_prestacao_contas(args);
      if (out.ok) ctx.lastDoc = { url: out.url, arquivo: out.arquivo, titulo: out.titulo };
      return out;
    }
    case "gerar_relatorio_periodo": {
      const out = await REL.gerar_relatorio_periodo(args);
      if (out.ok) ctx.lastDoc = { url: out.url, arquivo: out.arquivo, titulo: out.titulo };
      return out;
    }
    case "analisar_condominio": {
      const out = await REL.analisar_condominio(args);
      if (out.ok) ctx.lastDoc = { url: out.url, arquivo: out.arquivo, titulo: out.titulo };
      return out;
    }
    default: return { erro: `tool desconhecida: ${name}` };
  }
}

/** handleTurn(session, userText, ctx) -> { reply, doc, usage, toolsUsed }
 * usage = tokens deste turno (LOCAL — nunca global, p/ não misturar custo entre pessoas/turnos concorrentes).
 * toolsUsed = [{name, args}] das tools chamadas (base p/ a tag determinística + condomínio do log).
 * ctx._chat: seam de teste (default = o chat real do llm.mjs). */
export async function handleTurn(session, userText, ctx = {}) {
  const llm = ctx._chat || chat;
  if (!session.messages.length) {
    session.messages.push({ role: "system", content: SYSTEM_PROMPT });
  }
  // F3 — a data vai DENTRO da msg do turno (não concatenada no system na criação da sessão):
  // o prefixo [system+histórico] fica estável entre turnos (não quebra o cache) e a data está
  // sempre correta, mesmo numa sessão que atravessa a virada do dia (Redis, TTL 48h).
  session.messages.push({ role: "user", content: `(Hoje é ${hojeExtenso()}.) ${userText}` });
  const usage = { prompt: 0, completion: 0, cached: 0, modelo: config.agentModel };
  const toolsUsed = [];
  for (let i = 0; i < 8; i++) {
    const res = await llm({ messages: session.messages, tools: TOOLS, maxTokens: 1100, cacheKey: ctx?.cacheKey });
    const u = res.usage || {};
    usage.prompt += u.prompt_tokens || 0;
    usage.completion += u.completion_tokens || 0;
    usage.cached += u.prompt_tokens_details?.cached_tokens || 0;
    if (res.fallback) usage.modelo = res.fallback; // caiu pra reserva (Gemini) neste turno
    if (res.tool_calls?.length) {
      session.messages.push({ role: "assistant", content: res.content || null, tool_calls: res.tool_calls });
      for (const tc of res.tool_calls) {
        const args = safeParse(tc.function?.arguments || "{}");
        toolsUsed.push({ name: tc.function?.name, args });
        const out = await runTool(tc.function?.name, args, ctx);
        session.messages.push({ role: "tool", tool_call_id: tc.id, name: tc.function?.name, content: JSON.stringify(out) });
      }
      continue;
    }
    const reply = res.content || "Pode me dar mais um detalhe?";
    session.messages.push({ role: "assistant", content: reply });
    return { reply, doc: ctx.lastDoc || null, usage, toolsUsed };
  }
  return { reply: "Tive dificuldade em concluir — pode revisar os dados e tentar de novo?", doc: ctx.lastDoc || null, usage, toolsUsed };
}

export { TOOLS };
