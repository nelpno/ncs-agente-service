// agent.mjs — o cérebro: roda o loop (prompt + tools), resolve tool-calls contra implementações REAIS.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chat } from './llm.mjs';
import * as SL from './superlogica.mjs';
import * as OCTA from './octadesk.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, '..', 'spec', 'system-prompt.md'), 'utf8');

const TOOLS = [
  { type: 'function', function: { name: 'resolver_cadastro', description: 'Acha a(s) unidade(s) de uma pessoa pelo CPF (opcionalmente filtrando por condomínio). Use antes de buscar boleto. Retorna unidades com id_condominio e id_unidade.', parameters: { type: 'object', properties: { cpf: { type: 'string' }, condominio: { type: 'string' } }, required: ['cpf'] } } },
  { type: 'function', function: { name: 'get_boleto_2via', description: '2ª via do boleto pendente de uma unidade: retorna PIX copia-e-cola (st_pixqrcode_recb) e link. Vencido +30 dias retorna liberado:false (encaminhar à cobrança). Exige id_condominio e id_unidade (do resolver_cadastro).', parameters: { type: 'object', properties: { id_condominio: { type: 'string' }, id_unidade: { type: 'string' } }, required: ['id_condominio', 'id_unidade'] } } },
  { type: 'function', function: { name: 'get_inadimplencia', description: 'Status de adimplência da unidade.', parameters: { type: 'object', properties: { id_condominio: { type: 'string' }, id_unidade: { type: 'string' } }, required: ['id_condominio', 'id_unidade'] } } },
  { type: 'function', function: { name: 'marcar_tag', description: 'Marca uma tag na conversa (organização interna, ex.: 2a_via, mudanca, rh).', parameters: { type: 'object', properties: { tag: { type: 'string' } }, required: ['tag'] } } },
  { type: 'function', function: { name: 'transferir_humano', description: 'Encaminha a conversa para um atendente humano (boleto +30d, reclamação, RH, renegociação, ou quando não conseguiu resolver). Encerra o atendimento automático. Sempre passe motivo e um resumo.', parameters: { type: 'object', properties: { motivo: { type: 'string', enum: ['boleto_mais_30_dias', 'cobranca', 'reclamacao', 'rh', 'renegociacao', 'assembleia_sindico', 'cadastro_nao_encontrado', 'pessoa_pediu_humano', 'fora_de_escopo', 'nao_resolvido'] }, resumo: { type: 'string' } }, required: ['motivo', 'resumo'] } } },
];

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

async function runTool(name, args, ctx) {
  switch (name) {
    case 'resolver_cadastro': return await SL.resolver_cadastro(args);
    case 'get_boleto_2via': return await SL.get_boleto_2via(args);
    case 'get_inadimplencia': return await SL.get_inadimplencia(args);
    case 'marcar_tag': { if (ctx.chatId) await OCTA.marcar_tag(ctx.chatId, args.tag); return { ok: true }; }
    case 'transferir_humano': { ctx.transferred = { motivo: args.motivo, resumo: args.resumo }; if (ctx.chatId) await OCTA.transferir_humano({ chatId: ctx.chatId, motivo: args.motivo, resumo: args.resumo, fluxo: ctx.fluxo }); return { transferido: true }; }
    default: return { erro: `tool desconhecida: ${name}` };
  }
}

/**
 * handleTurn(session, userText, ctx) — processa UMA mensagem do contato.
 * ctx: { chatId, fluxo:{botid,componentid,roomkey} }
 * Retorna { reply, transferred }
 */
export async function handleTurn(session, userText, ctx) {
  if (!session.messages.length) session.messages.push({ role: 'system', content: SYSTEM_PROMPT });
  session.messages.push({ role: 'user', content: userText });
  for (let i = 0; i < 6; i++) {
    const res = await chat({ messages: session.messages, tools: TOOLS });
    if (res.tool_calls?.length) {
      session.messages.push({ role: 'assistant', content: res.content || null, tool_calls: res.tool_calls });
      for (const tc of res.tool_calls) {
        const out = await runTool(tc.function?.name, safeParse(tc.function?.arguments || '{}'), ctx);
        session.messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.function?.name, content: JSON.stringify(out) });
      }
      continue;
    }
    const reply = res.content || '';
    session.messages.push({ role: 'assistant', content: reply });
    return { reply, transferred: ctx.transferred || null };
  }
  return { reply: 'Vou te encaminhar para um atendente.', transferred: { motivo: 'nao_resolvido', resumo: 'loop' } };
}

export { TOOLS };
