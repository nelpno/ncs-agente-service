// agent.mjs — o cérebro: roda o loop (prompt + tools), resolve tool-calls contra implementações REAIS.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chat } from './llm.mjs';
import * as SL from './superlogica.mjs';
import * as OCTA from './octadesk.mjs';
import * as REG from './regimento.mjs';
import * as BG from './base_geral.mjs';
import * as MUD from './mudanca.mjs';
import * as PORT from './portaria.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, '..', 'spec', 'system-prompt.md'), 'utf8');

const TOOLS = [
  { type: 'function', function: { name: 'resolver_cadastro', description: 'Identifica a(s) unidade(s) da pessoa. Prefira por CPF; se ela não tem/não sabe o CPF, busque por NOME + condomínio. Retorna { encontrado, criterio (cpf|telefone|nome_exato|nome_completo|nome_parcial), confianca (alta|media|baixa), unidades:[{id_unidade, identificacao (bloco/unidade), condominio, id_condominio, papel, nome, ex_morador}] }. confianca ALTA = CPF/telefone (é a própria pessoa) → pode prosseguir. confianca MEDIA/BAIXA = achou por NOME, pode ser homônimo → CONFIRME um 2º dado (a unidade/bloco, ou parte do CPF) ANTES de entregar boleto/valor/dado sensível. motivo nome_exige_condominio = peça o condomínio. Use antes de qualquer ação que dependa da unidade.', parameters: { type: 'object', properties: { cpf: { type: 'string', description: 'CPF da pessoa (com ou sem máscara).' }, nome: { type: 'string', description: 'Nome completo (use quando a pessoa não tem/sabe o CPF; exige o condomínio).' }, condominio: { type: 'string', description: 'Nome do condomínio. Obrigatório na busca por nome.' } } } } },
  { type: 'function', function: { name: 'get_boleto_2via', description: '2ª via do boleto pendente de uma unidade: retorna PIX copia-e-cola (st_pixqrcode_recb) e link. Vencido +30 dias retorna liberado:false (encaminhar à cobrança). Exige id_condominio e id_unidade (do resolver_cadastro).', parameters: { type: 'object', properties: { id_condominio: { type: 'string' }, id_unidade: { type: 'string' } }, required: ['id_condominio', 'id_unidade'] } } },
  { type: 'function', function: { name: 'get_inadimplencia', description: 'Status de adimplência da unidade.', parameters: { type: 'object', properties: { id_condominio: { type: 'string' }, id_unidade: { type: 'string' } }, required: ['id_condominio', 'id_unidade'] } } },
  { type: 'function', function: { name: 'enviar_anexo_pdf', description: 'Envia o PDF da 2ª via do boleto como ANEXO no chat da pessoa. Use DEPOIS de get_boleto_2via (mesmos id_condominio e id_unidade), quando a pessoa pedir o boleto em PDF/arquivo. Retorna { enviado, vencimento, valor } ou { enviado:false, motivo } (ex.: sem boleto pendente, vencido +30 dias, garantidora). Não descreva o conteúdo do PDF nem repita/invente valores — só confirme que enviou o arquivo. O PIX copia-e-cola continua sendo o jeito mais rápido de pagar; o PDF é um complemento.', parameters: { type: 'object', properties: { id_condominio: { type: 'string' }, id_unidade: { type: 'string' } }, required: ['id_condominio', 'id_unidade'] } } },
  { type: 'function', function: { name: 'consultar_regimento', description: 'Consulta o Regimento Interno e a Convenção DO CONDOMÍNIO da pessoa para responder dúvidas sobre regras de convivência: animais/pet, horário de mudança, barulho/silêncio, piscina e áreas comuns (gourmet, grill, fitness, pet, coworking), obras/reformas, garagem/veículos, varanda/envidraçamento, lixo, multas/penalidades etc. Retorna trechos com a fonte exata (seção/artigo). Passe o condomínio identificado. RESPONDA SEMPRE CITANDO A FONTE retornada; se encontrou:false ou os trechos não cobrirem a dúvida, ofereça encaminhar a um humano — NUNCA invente uma regra.', parameters: { type: 'object', properties: { condominio: { type: 'string', description: 'Nome ou slug do condomínio da pessoa (ex.: Lume). Use o condomínio identificado no resolver_cadastro; se ainda não souber, pergunte.' }, pergunta: { type: 'string', description: 'A dúvida da pessoa, em texto livre.' } }, required: ['pergunta'] } } },
  { type: 'function', function: { name: 'consultar_base_geral', description: 'Consulta a BASE INSTITUCIONAL GLOBAL do Grupo NCS (igual para TODOS os condomínios): portfólio de serviços, Clube NCS e seus descontos/parceiros, projetos (Academia do Síndico, Momento com Síndico, Happy Hour), terceirização de mão de obra (portaria/limpeza/zeladoria), responsabilidade da administradora x do síndico, uso do app/área do condômino, e dados da empresa. NÃO use para regras de um condomínio específico (isso é consultar_regimento). Retorna {encontrou, trechos:[{fonte, texto}]}; CITE a fonte na resposta. Se encontrou=false, ofereça encaminhar a um humano — NUNCA invente.', parameters: { type: 'object', properties: { pergunta: { type: 'string', description: 'A dúvida do morador, em linguagem natural.' } }, required: ['pergunta'] } } },
  { type: 'function', function: { name: 'consultar_regra_mudanca', description: 'Consulta a REGRA DE MUDANÇA do condomínio da pessoa: horário permitido para mudança, se libera sábado, se é uma mudança por dia, e o procedimento (qual portaria/grupo de WhatsApp avisar, qual sistema cadastrar — Shielder/TW Virtua etc.). USE SEMPRE que a pessoa for agendar ou perguntar sobre mudança. Passe o condomínio identificado no resolver_cadastro. Retorna { encontrou, condominio, horario, procedimento, regras_gerais (mudança sem taxa, avisar com 24h de antecedência, agendar por formulário 24h ou atendente 8h às 17h45, aguardar termo de autorização) }. Se encontrou=false (condominio_nao_informado ou condominio_sem_regra), peça o condomínio ou ofereça confirmar o horário com a equipe — NUNCA invente horário. Para regras de CONVIVÊNCIA (animais, barulho, obras, áreas comuns) use consultar_regimento.', parameters: { type: 'object', properties: { condominio: { type: 'string', description: 'Nome ou slug do condomínio da pessoa (ex.: Lume). Use o condomínio identificado no resolver_cadastro; se ainda não souber, pergunte.' } }, required: ['condominio'] } } },
  { type: 'function', function: { name: 'consultar_sistema_portaria', description: 'Consulta QUAL sistema/app de PORTARIA o condomínio da pessoa usa (Shielder, GatWay, Synnus, Alarm System, TW Virtua). USE quando a pessoa perguntar sobre o aplicativo de portaria, controle de acesso, cadastro de visitante/dependente na portaria, ou "qual app eu uso pra portaria". Passe o condomínio identificado no resolver_cadastro. Retorna { encontrou, condominio, sistema, usa_shielder, sistema_conhecido, nota_geral }. Se usa_shielder=true, você PODE explicar o funcionamento do Shielder (o FAQ do Shielder vem de consultar_base_geral). Se for outro sistema (usa_shielder=false), informe qual é e oriente confirmar os detalhes com a portaria/equipe — NÃO explique o Shielder para quem não usa Shielder. Se sistema_conhecido=false ou encontrou=false, NÃO invente o sistema — ofereça confirmar com a equipe. Lembre: o financeiro (boletos) NUNCA é pela portaria; é pelo app Gruvi / Área do Condômino.', parameters: { type: 'object', properties: { condominio: { type: 'string', description: 'Nome ou slug do condomínio da pessoa (ex.: Vancouver). Use o condomínio identificado no resolver_cadastro; se ainda não souber, pergunte.' } }, required: ['condominio'] } } },
  { type: 'function', function: { name: 'marcar_tag', description: 'Marca uma tag na conversa (organização interna, ex.: 2a_via, mudanca, rh).', parameters: { type: 'object', properties: { tag: { type: 'string' } }, required: ['tag'] } } },
  { type: 'function', function: { name: 'transferir_humano', description: 'Encaminha a conversa para um atendente humano e encerra o atendimento automático. Use o motivo MAIS específico: agendamento_mudanca (pedido de mudança), cadastro_pendente (cadastrar inquilino/dependente ou trocar titularidade), boleto_mais_30_dias, cobranca, renegociacao, reclamacao, rh, assembleia_sindico, cadastro_nao_encontrado, pessoa_pediu_humano. Use fora_de_escopo/nao_resolvido só quando NENHUM outro servir. Sempre passe motivo e um resumo do caso.', parameters: { type: 'object', properties: { motivo: { type: 'string', enum: ['agendamento_mudanca', 'cadastro_pendente', 'boleto_mais_30_dias', 'cobranca', 'reclamacao', 'rh', 'renegociacao', 'assembleia_sindico', 'cadastro_nao_encontrado', 'pessoa_pediu_humano', 'fora_de_escopo', 'nao_resolvido'] }, resumo: { type: 'string' } }, required: ['motivo', 'resumo'] } } },
];

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

async function runToolReal(name, args, ctx) {
  switch (name) {
    case 'resolver_cadastro': return await SL.resolver_cadastro(args);
    case 'get_boleto_2via': return await SL.get_boleto_2via(args);
    case 'get_inadimplencia': return await SL.get_inadimplencia(args);
    case 'enviar_anexo_pdf': {
      const info = await SL.get_boleto_pdf_url(args);
      if (!info.ok) return { enviado: false, motivo: info.motivo, ...(info.garantidora ? { garantidora: info.garantidora } : {}) };
      // Só envia de fato quando há chat real (WhatsApp). Na UI de teste (sem chatId) retorna simulado p/ exercitar o fluxo.
      if (!ctx.chatId) return { enviado: true, simulado: true, vencimento: info.vencimento, valor: info.valor };
      try {
        await OCTA.enviar_anexo_url({ chatId: ctx.chatId, sourceUrl: info.pdf_url, filename: info.filename, body: 'Segue o boleto em PDF 📄' });
        return { enviado: true, vencimento: info.vencimento, valor: info.valor };
      } catch (e) { return { enviado: false, motivo: 'falha_envio', detalhe: e.message }; }
    }
    case 'consultar_regimento': return REG.consultar_regimento(args);
    case 'consultar_base_geral': return BG.consultar_base_geral(args);
    case 'consultar_regra_mudanca': return MUD.consultar_regra_mudanca(args);
    case 'consultar_sistema_portaria': return PORT.consultar_sistema_portaria(args);
    case 'marcar_tag': { if (ctx.chatId) await OCTA.marcar_tag(ctx.chatId, args.tag); return { ok: true }; }
    case 'transferir_humano': { ctx.transferred = { motivo: args.motivo, resumo: args.resumo }; if (ctx.chatId) await OCTA.transferir_humano({ chatId: ctx.chatId, motivo: args.motivo, resumo: args.resumo, fluxo: ctx.fluxo }); return { transferido: true }; }
    default: return { erro: `tool desconhecida: ${name}` };
  }
}

// G1 — handoff determinístico: detecta quando o modelo ANUNCIA transferência mas não chamou a ferramenta.
const ANNOUNCE_RE = /\b(vou|irei|vamos|posso|preciso)\b[^.!?]*\b(transferir|encaminhar)\b|\b(encaminhei|transferi|encaminhado|transferido)\b|registrar[^.!?]*(encaminh|transfer|equipe|time|setor)|(time|equipe|setor)\s+respons[aá]vel/i;

// CONFIRM_RE — detecta o RESUMO-DE-CONFIRMAÇÃO que a Ana apresenta ANTES de transferir (mudança 1):
// ela lista o pedido em tópicos e PERGUNTA se está correto / se a pessoa quer acrescentar algo.
// Esse passo é legítimo: NÃO deve disparar o nudge G1 (que forçaria a transferência imediata e atropelaria a confirmação).
// O handoff real só acontece no turno SEGUINTE, após o "sim" da pessoa (aí o modelo chama transferir_humano normalmente).
const CONFIRM_RE = /(confirmar?|conferir)[^.!?]*(correto|certo|acrescentar|adicionar|alterar|mudar|completar)|(quer|gostaria|deseja|precisa)[^.!?]*(acrescentar|adicionar|alterar|complementar|corrigir|mudar)|est[aá]\s+(tudo\s+)?(correto|certo)\s*\?|posso\s+(seguir|encaminhar|confirmar)\s+(com\s+)?(esse|este|isso)/i;

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
  // Retry 1x da chamada ao modelo antes de desistir: o gemini-3-flash em function calling solta erros transitórios
  // (ex.: 400 de thought_signature, que o retry de 429/5xx do llm.mjs NÃO cobre) que somem na 2ª tentativa.
  // Cobre o blip intermitente "Desculpa, não consegui processar agora" sem reescrever o fallback. chat() só LÊ
  // session.messages (não muta), então re-chamar é idempotente.
  const callModel = async () => {
    try {
      return await chat({ messages: session.messages, tools: TOOLS });
    } catch (e) {
      await new Promise((r) => setTimeout(r, 500));
      return await chat({ messages: session.messages, tools: TOOLS });
    }
  };
  for (let i = 0; i < 8; i++) {
    const res = await callModel();
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
    // RESUMO-DE-CONFIRMAÇÃO (mudança 1): a Ana apresenta o resumo em tópicos e pede confirmação ANTES de transferir.
    // Esse turno é legítimo (texto, sem tool-call) e NÃO pode ser atropelado pelo nudge G1 — suprime o nudge neste turno e devolve o resumo.
    // Detecção STATELESS (sem flag persistida): recalculada a cada turno via CONFIRM_RE.
    const isConfirmAsk = !ctx.transferred && CONFIRM_RE.test(reply);
    // G1 só força a transferência quando o modelo ANUNCIA encaminhamento SEM ser o passo de confirmação.
    if (!ctx.transferred && !isConfirmAsk && nudges < 1 && ANNOUNCE_RE.test(reply)) {
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
