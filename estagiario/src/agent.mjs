// agent.mjs — o Estagiário: loop (prompt + tools). Reusa o LLM e o RAG de regimento da Ana;
// adiciona as tools de documento (motor determinístico). Persona e porta de acesso SÃO separadas.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chat } from "../../src/llm.mjs";        // REUSO: mesmo cliente LLM da Ana
import * as REG from "../../src/regimento.mjs";  // REUSO: achar o artigo (isolado por condo)
import * as BG from "../../src/base_geral.mjs";  // REUSO: base institucional (Gruvi, links, responsabilidades) — dúvida de morador
import * as MUD from "../../src/mudanca.mjs";    // REUSO: regra de mudança por condo — dúvida de morador
import * as PORT from "../../src/portaria.mjs";  // REUSO: sistema/tipo de portaria por condo — dúvida de morador
import * as GRUVI from "../../src/gruvi.mjs";    // REUSO: vídeo tutorial do app Gruvi — dúvida de morador
import * as DOC from "./documentos.mjs";                         // NOVO: motor de geração de PDF
import * as REL from "./relatorio.mjs";                          // NOVO: relatório de prestação de contas

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, "..", "spec", "system-prompt.md"), "utf8");

const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
function hojeExtenso() { const d = new Date(); return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`; }

const TOOLS = [
  { type: "function", function: { name: "listar_infracoes", description: "Lista o cardápio FECHADO de infrações de um condomínio (id, título, palavras-chave). Use ANTES de gerar um documento para escolher o infracao_id correto a partir do relato. Nunca invente um id fora desta lista.", parameters: { type: "object", properties: { condominio: { type: "string", description: "Slug/nome do condomínio (ex.: vancouver, lume)." } }, required: ["condominio"] } } },
  { type: "function", function: { name: "buscar_morador", description: "Busca o morador de uma unidade no Superlógica (nome + se é proprietário/inquilino). Use quando o usuário der o condomínio + número do apartamento, para preencher o destinatário SEM o usuário digitar o nome. Sempre confirme o nome retornado com o usuário antes de gerar o documento.", parameters: { type: "object", properties: { condominio: { type: "string" }, unidade: { type: "string", description: "Número do apartamento, ex.: '132'." }, bloco: { type: "string", description: "Bloco/torre, se houver, ex.: '01'." } }, required: ["condominio", "unidade"] } } },
  { type: "function", function: { name: "consultar_regimento", description: "Consulta o Regimento Interno / Convenção do condomínio para responder dúvidas sobre regras (animais, barulho, mudança, obras, garagem, multas etc.). Retorna trechos com a fonte (seção/artigo). Responda SEMPRE citando a fonte; se encontrou:false, não invente — ofereça encaminhar.", parameters: { type: "object", properties: { condominio: { type: "string" }, pergunta: { type: "string" } }, required: ["pergunta"] } } },
  { type: "function", function: { name: "gerar_documento", description: "Gera o PDF da notificação ou multa (uma MINUTA para o síndico assinar). Só chame com TODOS os campos confirmados. O texto do artigo, a convenção e o cabeçalho são preenchidos pelo motor — você só fornece a classificação e o relato.", parameters: { type: "object", properties: {
      condominio: { type: "string" },
      tipo: { type: "string", enum: ["notificacao", "multa"] },
      nivel_reincidencia: { type: "integer", description: "1, 2, 3… (só para multa)." },
      infracao_id: { type: "string", description: "Um id retornado por listar_infracoes." },
      destinatario: { type: "object", properties: {
        nome: { type: "string" }, genero: { type: "string", enum: ["F", "M"] },
        papel: { type: "string", enum: ["proprietario", "morador", "inquilino", "responsavel"] },
        apartamento: { type: "string", description: "Ex.: '132 01'." },
      }, required: ["nome", "genero", "papel", "apartamento"] },
      relato: { type: "string", description: "O parágrafo da ocorrência, redigido por você em tom institucional, só com os fatos informados." },
      penalidade: { type: "object", properties: { taxas: { type: "integer" }, mes_boleto: { type: "string", description: "Ex.: 'novembro de 2025'." } }, description: "Obrigatório para tipo=multa." },
      data_documento: { type: "string", description: "Ex.: '13 de junho de 2026'. Se não informado, use hoje." },
    }, required: ["condominio", "tipo", "infracao_id", "destinatario", "relato", "data_documento"] } } },
  { type: "function", function: { name: "gerar_cnd", description: "Gera a DECLARAÇÃO DE QUITAÇÃO DE DÉBITOS (CND) de uma unidade — por padrão a via INFORMATIVA (sem assinatura). Use quando pedirem 'CND', 'nada consta', 'declaração de quitação' ou 'comprovante de quitação' de um morador/unidade. Informe o condomínio + número da unidade (e bloco, se houver). SÓ gera para unidade 100% em dia: se voltar ok:false (motivo inadimplente / no_juridico / garantidora_ou_cego / indisponivel), explique e NÃO afirme quitação. Devolve o link do PDF. A via OFICIAL assinada pelo síndico (Autentique) é uma etapa à parte.", parameters: { type: "object", properties: { condominio: { type: "string" }, unidade: { type: "string", description: "Número do apartamento, ex.: '132'." }, bloco: { type: "string", description: "Bloco/torre, se houver." }, tipo: { type: "string", enum: ["informativo"], description: "Por ora só 'informativo'." } }, required: ["condominio", "unidade"] } } },
  { type: "function", function: { name: "gerar_relatorio_prestacao_contas", description: "Gera o RELATÓRIO DE PRESTAÇÃO DE CONTAS de UM MÊS de um condomínio: receitas x despesas por categoria, previsto x realizado com alertas de estouro de orçamento (e gráfico quando há previsão), movimentação de caixa, inadimplência e resumo executivo em linguagem simples. Use quando pedirem 'prestação de contas', 'relatório do mês', 'fechamento do mês', 'balancete resumido' ou 'como fechou o mês' de UM mês. Para um INTERVALO de meses (ex.: 'de janeiro a maio', 'primeiro semestre'), use gerar_relatorio_periodo. Informe o condomínio e, se souber, o mês (nome ou número) e o ano; se o mês não for dito, usa o último mês fechado. Devolve o link do documento. É um relatório de APOIO à gestão (não substitui a prestação de contas oficial).", parameters: { type: "object", properties: { condominio: { type: "string" }, mes: { type: "string", description: "Mês de referência: número 1-12 ou o nome (ex.: 'junho'). Opcional — se omitido, usa o último mês fechado." }, ano: { type: "integer", description: "Ano de referência (ex.: 2026). Opcional." }, formato: { type: "string", enum: ["pdf", "word"], description: "Formato de saída. Opcional — padrão 'pdf'. Use 'word' se o usuário quiser um documento editável (para ajustar/complementar o texto)." } }, required: ["condominio"] } } },
  { type: "function", function: { name: "gerar_relatorio_periodo", description: "Gera o RELATÓRIO DE PRESTAÇÃO DE CONTAS CONSOLIDADO de um INTERVALO de meses (o equivalente ao relatório acumulado da Superlógica): totais e média mensal do período, tabela mês a mês, GRÁFICOS de evolução (receitas x despesas + resultado) e de previsto x realizado, despesas/receitas acumuladas por categoria, caixa e inadimplência. Use quando pedirem a prestação de contas 'de janeiro a maio', 'do primeiro semestre', 'do trimestre', 'acumulado do ano' ou qualquer intervalo de vários meses. Informe o condomínio, o mês inicial e o mês final (nome ou número) e, se souber, o ano (padrão: ano corrente). Devolve o link do documento. Relatório de APOIO à gestão.", parameters: { type: "object", properties: { condominio: { type: "string" }, mes_inicio: { type: "string", description: "Mês inicial do intervalo: número 1-12 ou nome (ex.: 'janeiro')." }, mes_fim: { type: "string", description: "Mês final do intervalo: número 1-12 ou nome (ex.: 'maio')." }, ano: { type: "integer", description: "Ano de referência (ex.: 2026). Opcional — padrão: ano corrente." }, formato: { type: "string", enum: ["pdf", "word"], description: "Formato de saída. Opcional — padrão 'pdf'. Use 'word' para documento editável." } }, required: ["condominio", "mes_inicio", "mes_fim"] } } },
  { type: "function", function: { name: "analisar_condominio", description: "Gera uma ANÁLISE com RECOMENDAÇÕES (consultivas) sobre a saúde financeira de um condomínio no período: se o resultado está equilibrado ou deficitário, se cabe avaliar reajuste da taxa ou manter, quais categorias de despesa pesam mais e valem revisão, inadimplência e tendência. Use quando pedirem 'qual a recomendação para este condomínio', 'análise financeira', 'o que sugerir para o equilíbrio das contas', 'devo reajustar a taxa?' ou 'onde dá para cortar'. As recomendações são SUGESTÕES de apoio — deixe claro que a decisão é do síndico/assembleia. Sem período informado, usa do início do ano até o último mês fechado. Devolve o link do documento.", parameters: { type: "object", properties: { condominio: { type: "string" }, mes_inicio: { type: "string", description: "Mês inicial (opcional)." }, mes_fim: { type: "string", description: "Mês final (opcional)." }, ano: { type: "integer", description: "Ano (opcional)." }, formato: { type: "string", enum: ["pdf", "word"], description: "Formato de saída (opcional, padrão 'pdf')." } }, required: ["condominio"] } } },
  // --- Dúvidas de morador (consulta rápida para a equipe) — mesmas fontes que o agente de clientes (a Ana). READ-ONLY. ---
  { type: "function", function: { name: "consultar_base_geral", description: "Consulta a BASE INSTITUCIONAL do Grupo NCS (igual para todos os condomínios) para responder uma dúvida de MORADOR que chegou à equipe: como usar o app Gruvi / Área do Condômino e o 1º acesso, os LINKS dos formulários e canais (mudança, cadastro de inquilino/dependente, atualização de titularidade, negociação de débitos, abertura de chamado, CND), responsabilidade da administradora x do síndico, Clube NCS, terceirização e dados da empresa. Use quando a equipe perguntar 'como o morador faz X', 'qual o link de X', 'como acesso o Gruvi', 'como pego o boleto'. Retorna {encontrou, trechos:[{fonte, texto}]}; entregue a informação pronta pra equipe repassar, citando a fonte, e passe os LINKS oficiais que vierem. Se encontrou=false, diga que não achou — NÃO invente link nem procedimento. Para regras de UM condomínio específico use consultar_regimento.", parameters: { type: "object", properties: { pergunta: { type: "string", description: "A dúvida do morador, em linguagem natural." } }, required: ["pergunta"] } } },
  { type: "function", function: { name: "consultar_regra_mudanca", description: "Consulta a REGRA DE MUDANÇA de um condomínio (horário permitido, antecedência, 1 por dia, sem taxa, como agendar). Use quando a equipe perguntar sobre a mudança de um morador. Informe o condomínio. Retorna { encontrou, condominio, horario, regras_condominio, regras_gerais }. ⚠️ NUNCA oriente o morador a avisar/contatar a portaria, a zeladoria ou o síndico, nem cadastrar em sistema (Shielder etc.) — quem faz isso é a própria NCS; a ferramenta nem entrega esse texto. O morador só preenche o formulário e aguarda o termo de autorização. Se encontrou=false, peça o condomínio ou ofereça confirmar o horário com a equipe — NÃO invente. Para regras de convivência (animais, barulho, obras) use consultar_regimento.", parameters: { type: "object", properties: { condominio: { type: "string" } }, required: ["condominio"] } } },
  { type: "function", function: { name: "consultar_sistema_portaria", description: "Consulta a PORTARIA de um condomínio: se é HUMANA, VIRTUAL ou HÍBRIDA (campo tipo_portaria) e qual o app/sistema de gestão (Shielder, GatWay, Synnus, Alarm System, TW Virtua). Use para perguntas como 'a portaria do Studio Five é humana ou remota?' ou 'qual o app de portaria do condomínio X?'. Informe o condomínio. Retorna { encontrou, condominio, sistema, tipo_portaria, tipo_conhecido, usa_shielder, sistema_conhecido, nota_geral }. O sistema/app é só a ferramenta de gestão — ele NÃO define se a portaria é humana ou virtual (isso é tipo_portaria). Se tipo_conhecido=false / sistema_conhecido=false / encontrou=false, NÃO invente — ofereça confirmar com a equipe/portaria. Lembre: financeiro/boleto NUNCA é pela portaria, é pelo app Gruvi.", parameters: { type: "object", properties: { condominio: { type: "string" } }, required: ["condominio"] } } },
  { type: "function", function: { name: "consultar_video_app", description: "Acha o VÍDEO tutorial oficial do app Gruvi que ensina a fazer algo no aplicativo (1º acesso/login, cadastrar a facial, validar documento, pegar boleto, reservar área comum, cadastrar veículo, liberar visitante/prestador, ver comunicados/documentos, abrir solicitação etc.). Use quando a equipe perguntar 'como o morador faz X no app', 'como acesso o Gruvi', 'como pego o boleto no app'. Passe o assunto em linguagem natural. Retorna { encontrou, titulo, url }. Se encontrou=true, passe a URL do vídeo pra equipe repassar ao morador. Se encontrou=false, NÃO invente link.", parameters: { type: "object", properties: { assunto: { type: "string", description: "O que a pessoa quer fazer no app, em texto livre (ex.: 'pegar boleto', 'cadastrar facial')." } }, required: ["assunto"] } } },
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

/** handleTurn(session, userText, ctx) -> { reply, doc } */
export async function handleTurn(session, userText, ctx = {}) {
  if (!session.messages.length) {
    session.messages.push({ role: "system", content: SYSTEM_PROMPT + `\n\n(Data de hoje: ${hojeExtenso()}.)` });
  }
  session.messages.push({ role: "user", content: userText });
  for (let i = 0; i < 8; i++) {
    const res = await chat({ messages: session.messages, tools: TOOLS, maxTokens: 1100 });
    if (res.tool_calls?.length) {
      session.messages.push({ role: "assistant", content: res.content || null, tool_calls: res.tool_calls });
      for (const tc of res.tool_calls) {
        const out = await runTool(tc.function?.name, safeParse(tc.function?.arguments || "{}"), ctx);
        session.messages.push({ role: "tool", tool_call_id: tc.id, name: tc.function?.name, content: JSON.stringify(out) });
      }
      continue;
    }
    const reply = res.content || "Pode me dar mais um detalhe?";
    session.messages.push({ role: "assistant", content: reply });
    return { reply, doc: ctx.lastDoc || null };
  }
  return { reply: "Tive dificuldade em concluir — pode revisar os dados e tentar de novo?", doc: ctx.lastDoc || null };
}

export { TOOLS };
