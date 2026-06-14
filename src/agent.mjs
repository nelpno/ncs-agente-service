// agent.mjs — o cérebro: roda o loop (prompt + tools), resolve tool-calls contra implementações REAIS.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chat } from './llm.mjs';
import * as SL from './superlogica.mjs';
import * as OCTA from './octadesk.mjs';
import * as REG from './regimento.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, '..', 'spec', 'system-prompt.md'), 'utf8');

const TOOLS = [
  { type: 'function', function: { name: 'resolver_cadastro', description: 'Identifica a(s) unidade(s) da pessoa. Prefira por CPF; se ela não tem/não sabe o CPF, busque por NOME + condomínio. Retorna { encontrado, criterio (cpf|telefone|nome_exato|nome_completo|nome_parcial), confianca (alta|media|baixa), unidades:[{id_unidade, identificacao (bloco/unidade), condominio, id_condominio, papel, nome, ex_morador}] }. confianca ALTA = CPF/telefone (é a própria pessoa) → pode prosseguir. confianca MEDIA/BAIXA = achou por NOME, pode ser homônimo → CONFIRME um 2º dado (a unidade/bloco, ou parte do CPF) ANTES de entregar boleto/valor/dado sensível. motivo nome_exige_condominio = peça o condomínio. Use antes de qualquer ação que dependa da unidade.', parameters: { type: 'object', properties: { cpf: { type: 'string', description: 'CPF da pessoa (com ou sem máscara).' }, nome: { type: 'string', description: 'Nome completo (use quando a pessoa não tem/sabe o CPF; exige o condomínio).' }, condominio: { type: 'string', description: 'Nome do condomínio. Obrigatório na busca por nome.' } } } } },
  { type: 'function', function: { name: 'get_boleto_2via', description: '2ª via do boleto pendente de uma unidade: retorna PIX copia-e-cola (st_pixqrcode_recb) e link. Vencido +30 dias retorna liberado:false (encaminhar à cobrança). Exige id_condominio e id_unidade (do resolver_cadastro).', parameters: { type: 'object', properties: { id_condominio: { type: 'string' }, id_unidade: { type: 'string' } }, required: ['id_condominio', 'id_unidade'] } } },
  { type: 'function', function: { name: 'get_inadimplencia', description: 'Status de adimplência da unidade.', parameters: { type: 'object', properties: { id_condominio: { type: 'string' }, id_unidade: { type: 'string' } }, required: ['id_condominio', 'id_unidade'] } } },
  { type: 'function', function: { name: 'consultar_regimento', description: 'Consulta o Regimento Interno e a Convenção DO CONDOMÍNIO da pessoa para responder dúvidas sobre regras de convivência: animais/pet, horário de mudança, barulho/silêncio, piscina e áreas comuns (gourmet, grill, fitness, pet, coworking), obras/reformas, garagem/veículos, varanda/envidraçamento, lixo, multas/penalidades etc. Retorna trechos com a fonte exata (seção/artigo). Passe o condomínio identificado. RESPONDA SEMPRE CITANDO A FONTE retornada; se encontrou:false ou os trechos não cobrirem a dúvida, ofereça encaminhar a um humano — NUNCA invente uma regra.', parameters: { type: 'object', properties: { condominio: { type: 'string', description: 'Nome ou slug do condomínio da pessoa (ex.: Lume). Use o condomínio identificado no resolver_cadastro; se ainda não souber, pergunte.' }, pergunta: { type: 'string', description: 'A dúvida da pessoa, em texto livre.' } }, required: ['pergunta'] } } },
  { type: 'function', function: { name: 'marcar_tag', description: 'Marca uma tag na conversa (organização interna, ex.: 2a_via, mudanca, rh).', parameters: { type: 'object', properties: { tag: { type: 'string' } }, required: ['tag'] } } },
  { type: 'function', function: { name: 'transferir_humano', description: 'Encaminha a conversa para um atendente humano e encerra o atendimento automático. Use o motivo MAIS específico: agendamento_mudanca (pedido de mudança), cadastro_pendente (cadastrar inquilino/dependente ou trocar titularidade), boleto_mais_30_dias, cobranca, renegociacao, reclamacao, rh, assembleia_sindico, cadastro_nao_encontrado, pessoa_pediu_humano. Use fora_de_escopo/nao_resolvido só quando NENHUM outro servir. Sempre passe motivo e um resumo do caso.', parameters: { type: 'object', properties: { motivo: { type: 'string', enum: ['agendamento_mudanca', 'cadastro_pendente', 'boleto_mais_30_dias', 'cobranca', 'reclamacao', 'rh', 'renegociacao', 'assembleia_sindico', 'cadastro_nao_encontrado', 'pessoa_pediu_humano', 'fora_de_escopo', 'nao_resolvido'] }, resumo: { type: 'string' } }, required: ['motivo', 'resumo'] } } },
];

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

async function runToolReal(name, args, ctx) {
  switch (name) {
    case 'resolver_cadastro': return await SL.resolver_cadastro(args);
    case 'get_boleto_2via': return await SL.get_boleto_2via(args);
    case 'get_inadimplencia': return await SL.get_inadimplencia(args);
    case 'consultar_regimento': return REG.consultar_regimento(args);
    case 'marcar_tag': { if (ctx.chatId) await OCTA.marcar_tag(ctx.chatId, args.tag); return { ok: true }; }
    case 'transferir_humano': { ctx.transferred = { motivo: args.motivo, resumo: args.resumo }; if (ctx.chatId) await OCTA.transferir_humano({ chatId: ctx.chatId, motivo: args.motivo, resumo: args.resumo, fluxo: ctx.fluxo }); return { transferido: true }; }
    default: return { erro: `tool desconhecida: ${name}` };
  }
}

// G1 — handoff determinístico: detecta quando o modelo ANUNCIA transferência mas não chamou a ferramenta.
const ANNOUNCE_RE = /\b(vou|irei|vamos|posso|preciso)\b[^.!?]*\b(transferir|encaminhar)\b|\b(encaminhei|transferi|encaminhado|transferido)\b|registrar[^.!?]*(encaminh|transfer|equipe|time|setor)|(time|equipe|setor)\s+respons[aá]vel/i;

/**
 * runAgentLoop — loop genérico do agente (NLU + tools), agnóstico de implementação de tools.
 * runTool(name, args, ctx) é injetado: o piloto passa as tools reais; o harness de stress passa mocks.
 * Garante o handoff determinístico (G1): se o modelo diz que vai encaminhar mas não chamou
 * transferir_humano, força a chamada uma vez antes de devolver a resposta.
 */
export async function runAgentLoop(session, systemPrompt, userText, ctx, runTool) {
  if (!session.messages.length) session.messages.push({ role: 'system', content: systemPrompt });
  session.messages.push({ role: 'user', content: userText });
  let nudges = 0, emptyRetries = 0;
  for (let i = 0; i < 8; i++) {
    const res = await chat({ messages: session.messages, tools: TOOLS });
    if (res.tool_calls?.length) {
      session.messages.push({ role: 'assistant', content: res.content || null, tool_calls: res.tool_calls });
      for (const tc of res.tool_calls) {
        const out = await runTool(tc.function?.name, safeParse(tc.function?.arguments || '{}'), ctx);
        session.messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.function?.name, content: JSON.stringify(out) });
      }
      continue;
    }
    let reply = res.content || '';
    // robustez: o modelo às vezes devolve resposta vazia sem chamar ferramenta — tenta de novo antes de desistir.
    if (!reply && !ctx.transferred && emptyRetries < 2) { emptyRetries++; continue; }
    if (!ctx.transferred && nudges < 1 && ANNOUNCE_RE.test(reply)) {
      nudges++;
      session.messages.push({ role: 'assistant', content: reply });
      session.messages.push({ role: 'system', content: 'Você indicou que vai encaminhar/transferir, mas NÃO chamou a ferramenta transferir_humano. Se realmente é caso de encaminhar, chame transferir_humano AGORA (motivo mais específico + resumo). Se não for, responda normalmente, sem prometer encaminhamento.' });
      continue;
    }
    if (!reply) reply = ctx.transferred
      ? 'Pronto! Vou te encaminhar para o setor responsável, que vai dar sequência e te ajudar com isso. 🙏'
      : 'Desculpa, não consegui processar agora. Pode reformular ou me dar mais um detalhe?';
    session.messages.push({ role: 'assistant', content: reply });
    return { reply, transferred: ctx.transferred || null };
  }
  return { reply: 'Vou te encaminhar para um atendente.', transferred: ctx.transferred || { motivo: 'nao_resolvido', resumo: 'loop' } };
}

/**
 * handleTurn(session, userText, ctx) — processa UMA mensagem do contato (piloto: tools reais).
 * ctx: { chatId, fluxo:{botid,componentid,roomkey} }. Retorna { reply, transferred }.
 */
export async function handleTurn(session, userText, ctx) {
  return runAgentLoop(session, SYSTEM_PROMPT, userText, ctx, runToolReal);
}

export { TOOLS };
