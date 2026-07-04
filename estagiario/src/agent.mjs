// agent.mjs — o Estagiário: loop (prompt + tools). Reusa o LLM e o RAG de regimento da Ana;
// adiciona as tools de documento (motor determinístico). Persona e porta de acesso SÃO separadas.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chat } from "../../src/llm.mjs";        // REUSO: mesmo cliente LLM da Ana
import * as REG from "../../src/regimento.mjs";  // REUSO: achar o artigo (isolado por condo)
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
  { type: "function", function: { name: "gerar_relatorio_prestacao_contas", description: "Gera o PDF do RELATÓRIO DE PRESTAÇÃO DE CONTAS mensal de um condomínio: receitas x despesas por categoria, previsto x realizado com alertas de estouro de orçamento, movimentação de caixa (saldo inicial/entradas/saídas/final), inadimplência e um resumo executivo em linguagem simples. Use quando pedirem 'prestação de contas', 'relatório do mês', 'fechamento do mês', 'balancete resumido' ou 'como fechou o mês' de um condomínio. Informe o condomínio e, se souber, o mês (nome ou número) e o ano; se o mês não for dito, usa o último mês fechado. Devolve o link do PDF. É um relatório de APOIO à gestão (não substitui a prestação de contas oficial).", parameters: { type: "object", properties: { condominio: { type: "string" }, mes: { type: "string", description: "Mês de referência: número 1-12 ou o nome (ex.: 'junho'). Opcional — se omitido, usa o último mês fechado." }, ano: { type: "integer", description: "Ano de referência (ex.: 2026). Opcional." } }, required: ["condominio"] } } },
];

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

async function runTool(name, args, ctx) {
  switch (name) {
    case "listar_infracoes": return DOC.listar_infracoes(args);
    case "buscar_morador": return await DOC.buscar_morador(args);
    case "consultar_regimento": return REG.consultar_regimento(args);
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
