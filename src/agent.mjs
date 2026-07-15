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
import * as GRUVI from './gruvi.mjs';
import * as TAXA from './taxa.mjs';
import * as CND from './cnd.mjs';
import * as ENGINE from './write/engine.mjs';
import './write/actions/cadastro_inquilino.mjs'; // side-effect: registerAction
import { agoraContextoTemporal } from './tempo.mjs';
import { podarHistorico } from './history.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = fs.readFileSync(process.env.SYSTEM_PROMPT_PATH || path.join(__dirname, '..', 'spec', 'system-prompt.md'), 'utf8');

// F4 — poda de histórico atrás da env HIST_CAP (rollback por env, sem rebuild de imagem).
// Ausente / "0" / "off" = DESLIGADO (comportamento de hoje). Um número liga a poda com esse
// teto de mensagens. keepTurns=2: os 2 últimos turnos mantêm o resultado de tool verbatim.
const HIST_CAP_RAW = process.env.HIST_CAP;
const HIST_ON = !!HIST_CAP_RAW && HIST_CAP_RAW !== '0' && HIST_CAP_RAW.toLowerCase() !== 'off';
const HIST_CAP_N = HIST_ON ? (parseInt(HIST_CAP_RAW, 10) || 40) : 0;

const TOOLS = [
  { type: 'function', function: { name: 'resolver_cadastro', description: 'Identifica a(s) unidade(s) da pessoa. Prefira por CPF; se ela não tem/não sabe o CPF, busque por NOME + UNIDADE (bloco e apartamento) + condomínio — nome + unidade dá confiança ALTA (o apartamento restringe e o nome confirma). Retorna { encontrado, criterio (cpf|unidade_nome|telefone|nome_exato|nome_completo|nome_parcial), confianca (alta|media|baixa), unidades:[{id_unidade, identificacao (bloco/unidade), condominio, id_condominio, papel, nome, ex_morador}] }. confianca ALTA = CPF/telefone/unidade+nome (é a própria pessoa) → pode prosseguir. confianca MEDIA/BAIXA = achou só por NOME (homônimo possível) ou só pela unidade → CONFIRME um 2º dado (a unidade/bloco, ou parte do CPF) ANTES de entregar boleto/valor/dado sensível. motivo nome_exige_condominio = peça o condomínio. Use antes de qualquer ação que dependa da unidade.', parameters: { type: 'object', properties: { cpf: { type: 'string', description: 'CPF da pessoa (com ou sem máscara).' }, nome: { type: 'string', description: 'Nome completo (use quando a pessoa não tem/sabe o CPF).' }, condominio: { type: 'string', description: 'Nome do condomínio. Obrigatório na busca por nome/unidade.' }, unidade: { type: 'string', description: 'Unidade da pessoa (bloco/torre e apartamento, ex.: "Bloco 7 ap 401", "apto 142 torre 2"). Combine com nome quando não há CPF.' } } } } },
  { type: 'function', function: { name: 'get_boleto_2via', description: '2ª via do boleto pendente de uma unidade: retorna PIX copia-e-cola (st_pixqrcode_recb) e link. Vencido +30 dias retorna liberado:false motivo:"boleto vencido +30 dias" (encaminhar à cobrança). Unidade em PROCESSO JUDICIAL retorna liberado:false motivo:unidade_no_juridico → NÃO mande PIX nem link (o boleto público fica indisponível "porque a unidade está no jurídico"); encaminhe à cobrança. Exige id_condominio e id_unidade (do resolver_cadastro).', parameters: { type: 'object', properties: { id_condominio: { type: 'string' }, id_unidade: { type: 'string' } }, required: ['id_condominio', 'id_unidade'] } } },
  { type: 'function', function: { name: 'get_inadimplencia', description: 'Situação COMPLETA de débitos da unidade — inclui boletos ANTIGOS, em cobrança e jurídico (não só os recentes). USE em "estou devendo?", "quanto devo?", "só devo esse boleto?", "estou quitado?". Retorna { status }: `inadimplente` (+`qtd_cobrancas_em_aberto`) = há débitos em aberto; `sem_debito_vencido` = não consta inadimplência (mas pode haver boleto A VENCER → get_boleto_2via); `gerido_por_garantidora` = cobrança pela garantidora; `indisponivel` = consulta falhou. `no_juridico:true` = PROCESSO JUDICIAL aberto → NÃO ofereça 2ª via/PIX, encaminhe à cobrança. NUNCA afirme um valor total a pagar.', parameters: { type: 'object', properties: { id_condominio: { type: 'string' }, id_unidade: { type: 'string' } }, required: ['id_condominio', 'id_unidade'] } } },
  { type: 'function', function: { name: 'enviar_anexo_pdf', description: 'Envia o PDF da 2ª via do boleto como ANEXO no chat da pessoa. Chame SEMPRE logo após get_boleto_2via com liberado:true (mesmos id_condominio e id_unidade), no MESMO turno — o boleto em PDF vai sempre junto, sem esperar a pessoa pedir. Retorna { enviado, vencimento, valor } ou { enviado:false, motivo } (ex.: sem boleto pendente, vencido +30 dias, garantidora). Não descreva o conteúdo do PDF nem invente valores; o texto da sua resposta (PIX + valor + vencimento + link) é entregue na mesma mensagem do anexo. O PIX copia-e-cola é o jeito mais rápido de pagar; o PDF é o complemento.', parameters: { type: 'object', properties: { id_condominio: { type: 'string' }, id_unidade: { type: 'string' } }, required: ['id_condominio', 'id_unidade'] } } },
  { type: 'function', function: { name: 'consultar_regimento', description: 'Consulta o Regimento Interno e a Convenção DO CONDOMÍNIO da pessoa para responder dúvidas sobre regras de convivência: animais/pet, horário de mudança, barulho/silêncio, piscina e áreas comuns (gourmet, grill, fitness, pet, coworking), obras/reformas, garagem/veículos, varanda/envidraçamento, lixo, multas/penalidades etc. Retorna trechos com a fonte exata (seção/artigo). Passe o condomínio identificado. RESPONDA SEMPRE CITANDO A FONTE retornada; se encontrou:false ou os trechos não cobrirem a dúvida, ofereça encaminhar a um humano — NUNCA invente uma regra.', parameters: { type: 'object', properties: { condominio: { type: 'string', description: 'Nome ou slug do condomínio da pessoa (ex.: Lume). Use o condomínio identificado no resolver_cadastro; se ainda não souber, pergunte.' }, pergunta: { type: 'string', description: 'A dúvida da pessoa, em texto livre.' } }, required: ['pergunta'] } } },
  { type: 'function', function: { name: 'consultar_base_geral', description: 'Consulta a BASE INSTITUCIONAL GLOBAL do Grupo NCS (igual para TODOS os condomínios): portfólio de serviços, Clube NCS e seus descontos/parceiros, projetos (Academia do Síndico, Momento com Síndico, Happy Hour), terceirização de mão de obra (portaria/limpeza/zeladoria), responsabilidade da administradora x do síndico, uso do app/área do condômino, e dados da empresa. NÃO use para regras de um condomínio específico (isso é consultar_regimento). Retorna {encontrou, trechos:[{fonte, texto}]}; CITE a fonte na resposta. Se encontrou=false, ofereça encaminhar a um humano — NUNCA invente.', parameters: { type: 'object', properties: { pergunta: { type: 'string', description: 'A dúvida do morador, em linguagem natural.' } }, required: ['pergunta'] } } },
  { type: 'function', function: { name: 'consultar_regra_mudanca', description: 'Consulta a REGRA DE MUDANÇA do condomínio (conteúdo SEGURO PARA O MORADOR). USE SEMPRE que a pessoa for agendar/perguntar sobre mudança. Passe o condomínio do resolver_cadastro. Retorna { encontrou, condominio, horario, regras_condominio (antecedência específica e "1 por dia", quando houver), regras_gerais (sem taxa; ~72h de antecedência; formulário 24h ou atendente 8h–17h45; aguardar o termo) }. A ferramenta NÃO entrega procedimento interno: quem avisa portaria/zeladoria e cadastra nos sistemas é a NCS, nunca o morador. encontrou=false (condominio_nao_informado/condominio_sem_regra) → peça o condomínio ou ofereça confirmar; nunca invente horário. Regras de convivência (animais, barulho, obras, áreas comuns) = consultar_regimento.', parameters: { type: 'object', properties: { condominio: { type: 'string', description: 'Nome ou slug do condomínio da pessoa (ex.: Lume). Use o condomínio identificado no resolver_cadastro; se ainda não souber, pergunte.' } }, required: ['condominio'] } } },
  { type: 'function', function: { name: 'consultar_sistema_portaria', description: 'Consulta QUAL sistema/app de PORTARIA o condomínio usa (Shielder, GatWay, Synnus, Alarm System, TW Virtua) e o modelo de operação. USE sobre app de portaria/controle de acesso/cadastro de visitante, ou "a portaria é humana ou virtual?". Passe o condomínio do resolver_cadastro. Retorna { encontrou, condominio, sistema, tipo_portaria, usa_shielder, sistema_conhecido, nota_geral }. "Humana ou virtual?" responde-se SÓ pelo tipo_portaria (usar Shielder/etc. ≠ virtual). usa_shielder=true → pode explicar o Shielder (FAQ via consultar_base_geral); outro sistema → informe qual, não explique Shielder p/ quem não usa. sistema_conhecido=false/encontrou=false → não invente. Boletos nunca são pela portaria (app Gruvi).', parameters: { type: 'object', properties: { condominio: { type: 'string', description: 'Nome ou slug do condomínio da pessoa (ex.: Vancouver). Use o condomínio identificado no resolver_cadastro; se ainda não souber, pergunte.' } }, required: ['condominio'] } } },
  { type: 'function', function: { name: 'consultar_video_app', description: 'Acha o VÍDEO tutorial oficial do app Gruvi para fazer algo NO APLICATIVO (login/1º acesso, "não consigo entrar", cadastrar a facial, validar documento, atualizar dados, pegar boleto, reservar área, cadastrar veículo, liberar visitante, ver comunicados/documentos/encomendas etc.). USE em "como faço X no app/Gruvi", "não consigo entrar no app", "como cadastro a facial". Passe o assunto em linguagem natural. Retorna { encontrou, titulo, url }. encontrou=true → mande a URL CRUA (passo a passo em vídeo); encontrou=false → não invente link. (Regras do condomínio = consultar_regimento; boleto = get_boleto_2via.)', parameters: { type: 'object', properties: { assunto: { type: 'string', description: 'O que a pessoa quer fazer no app, em texto livre (ex.: "cadastrar reconhecimento facial", "pegar boleto", "liberar visitante").' } }, required: ['assunto'] } } },
  { type: 'function', function: { name: 'consultar_taxa_condominial', description: 'Consulta o que está INCLUSO NA TAXA CONDOMINIAL (gás, água, internet) de um condomínio específico. USE em "o gás está incluso?", "a água é inclusa na taxa?", "quais provedores de internet o condomínio libera?". Passe o condomínio identificado (do resolver_cadastro, se já souber). Retorna { encontrou, condominio, itens:{ gas:{incluso, empresa}, agua:{incluso}, internet:[...] }, resumo }. encontrou=false (condominio_nao_informado/condominio_sem_dado_taxa/condominio_ambiguo) → não invente; peça o condomínio ou ofereça confirmar com a equipe.', parameters: { type: 'object', properties: { condominio: { type: 'string', description: 'Nome ou slug do condomínio da pessoa (ex.: Lume). Use o condomínio identificado no resolver_cadastro; se ainda não souber, pergunte.' } }, required: ['condominio'] } } },
  { type: 'function', function: { name: 'enviar_cnd', description: 'Gera e envia a DECLARAÇÃO DE QUITAÇÃO DE DÉBITOS (CND) — via INFORMATIVA, SEM assinatura — como PDF no chat. Use quando a pessoa pedir "nada consta", "declaração de quitação", "CND", "comprovante de que estou em dia/quitado". Exige id_condominio e id_unidade (do resolver_cadastro). SÓ gera para quem está 100% em dia: se houver débito retorna { enviado:false, motivo:"inadimplente" } (direcione à Negociação de Débitos), processo judicial { motivo:"no_juridico" } (jurídico/cobrança), garantidora { motivo:"garantidora_ou_cego" } (canal da garantidora) ou { motivo:"indisponivel" } (ofereça atendente) — NUNCA afirme quitação quando não gerar. Esta é a via informativa (de conferência); a via OFICIAL assinada pelo síndico é solicitada à parte. Ao enviar, só confirme que mandou o PDF — não invente/transcreva o conteúdo.', parameters: { type: 'object', properties: { id_condominio: { type: 'string' }, id_unidade: { type: 'string' } }, required: ['id_condominio', 'id_unidade'] } } },
  { type: 'function', function: { name: 'marcar_tag', description: 'Marca uma tag na conversa (organização interna, ex.: 2a_via, mudanca, rh).', parameters: { type: 'object', properties: { tag: { type: 'string' } }, required: ['tag'] } } },
  { type: 'function', function: { name: 'transferir_humano', description: 'Encaminha a conversa para um atendente humano e encerra o atendimento automático. Use o motivo MAIS específico: agendamento_mudanca (pedido de mudança), cadastro_pendente (cadastrar inquilino/dependente ou trocar titularidade), boleto_mais_30_dias, cobranca, renegociacao, reclamacao, rh, assembleia_sindico, cadastro_nao_encontrado, pessoa_pediu_humano. Use fora_de_escopo/nao_resolvido só quando NENHUM outro servir. Sempre passe motivo e um resumo do caso.', parameters: { type: 'object', properties: { motivo: { type: 'string', enum: ['agendamento_mudanca', 'cadastro_pendente', 'boleto_mais_30_dias', 'cobranca', 'reclamacao', 'rh', 'renegociacao', 'assembleia_sindico', 'cadastro_nao_encontrado', 'pessoa_pediu_humano', 'fora_de_escopo', 'nao_resolvido'] }, resumo: { type: 'string' } }, required: ['motivo', 'resumo'] } } },
  { type: 'function', function: { name: 'criar_rascunho_cadastro',
    description: 'Prepara o cadastro de um inquilino/residente ou dependente numa unidade. NÃO grava: monta o pedido e envia para a equipe aprovar antes de entrar no sistema. Use quando o morador pede para cadastrar alguém.',
    parameters: { type: 'object', properties: {
      id_condominio: { type: 'string' }, id_unidade: { type: 'string' },
      nome: { type: 'string' }, papel: { type: 'string', enum: ['inquilino', 'dependente'] },
      data_entrada: { type: 'string', description: 'MM/DD/AAAA' },
      email: { type: 'string' }, telefone: { type: 'string' }, cpf: { type: 'string' },
      responsavel_cobranca: { type: 'string', enum: ['proprietario', 'inquilino'],
        description: 'Quem recebe o boleto da taxa. Só para papel=inquilino, e só se a pessoa disser — pergunte, não deduza. Na maioria é o proprietário (default se omitido). Dependente nunca recebe.' },
    }, required: ['id_unidade', 'nome', 'data_entrada'] } } },
];

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

/**
 * _pushAnexo — registra o PDF p/ o adapter entregar no canal real, COM a identificação da unidade.
 * O rótulo vem do ERP (`ctx.unidades`, colhido pelo resolver_cadastro), NUNCA do LLM: com dois
 * boletos na mesma conversa ("de ambos"), é isso que faz cada PDF dizer de qual unidade é — e o
 * que impede trocar a etiqueta de um pelo outro. Sem rótulo conhecido → null (não inventa).
 * Ver test/test_anexo_rotulo.mjs e .tmp/test_legenda_anexo.mjs (o outro lado, no adapter).
 */
export function _pushAnexo(ctx, info, idUnidade) {
  (ctx.attachments ||= []).push({
    url: info.pdf_url,
    filename: info.filename,
    kind: 'pdf',
    unidade: ctx.unidades?.[String(idUnidade)] || null,
    vencimento: info.vencimento || null,
  });
}

async function runToolReal(name, args, ctx) {
  switch (name) {
    // ctx.lastCondo rastreia o condomínio em foco (id + nome) p/ rotear a cobrança no handoff (ver transferir_humano).
    // Setado pelas tools que recebem id_condominio explícito (sinal preciso) e pelo resolver quando há 1 única unidade.
    case 'resolver_cadastro': {
      const r = await SL.resolver_cadastro(args); const us = r?.unidades || [];
      if (us.length === 1 && us[0].id_condominio) ctx.lastCondo = { id: String(us[0].id_condominio), nome: us[0].condominio };
      // Guarda o rótulo HUMANO de cada unidade vista ("QUADRA 20 / LOTE 0314"), direto do ERP.
      // O card de aprovação mostra isso em vez do id interno (14381), que o aprovador não acha no
      // Superlógica. Vem daqui e não do LLM justamente p/ não ser inventado.
      for (const u of us) if (u.id_unidade) (ctx.unidades ||= {})[String(u.id_unidade)] = u.identificacao || null;
      // Idem p/ o NOME do condomínio. Não basta o ctx.lastCondo: além de morrer no fim do turno, ele
      // é reescrito por get_boleto_2via como { id: novo, nome: ANTIGO } → trocar de condomínio deixa
      // o nome errado. O mapa id→nome não desalinha. Sem o nome, o posGravar não resolve a portaria
      // e o aviso NÃO sai ("condominio_nao_resolvido" — visto na aprovação real de 15/07).
      for (const u of us) if (u.id_condominio) (ctx.condominios ||= {})[String(u.id_condominio)] = u.condominio || null;
      return r;
    }
    case 'get_boleto_2via': { if (args.id_condominio) ctx.lastCondo = { id: String(args.id_condominio), nome: ctx.lastCondo?.nome }; return await SL.get_boleto_2via(args); }
    case 'get_inadimplencia': { if (args.id_condominio) ctx.lastCondo = { id: String(args.id_condominio), nome: ctx.lastCondo?.nome }; return await SL.get_inadimplencia(args); }
    case 'enviar_anexo_pdf': {
      if (args.id_condominio) ctx.lastCondo = { id: String(args.id_condominio), nome: ctx.lastCondo?.nome };
      const info = await SL.get_boleto_pdf_url(args);
      if (!info.ok) return { enviado: false, motivo: info.motivo, ...(info.garantidora ? { garantidora: info.garantidora } : {}) };
      // Octadesk (WhatsApp): envia direto pela API do Octadesk.
      if (ctx.chatId) {
        try {
          await OCTA.enviar_anexo_url({ chatId: ctx.chatId, sourceUrl: info.pdf_url, filename: info.filename, body: 'Segue o boleto em PDF 📄' });
          return { enviado: true, vencimento: info.vencimento, valor: info.valor };
        } catch (e) { return { enviado: false, motivo: 'falha_envio', detalhe: e.message }; }
      }
      // Outros canais (Chatwoot via adapter): registra o anexo p/ o caller baixar e postar no canal real.
      // A UI de teste HTML ignora o campo (não renderiza anexo), mas o canal real (Chatwoot) entrega de fato.
      _pushAnexo(ctx, info, args.id_unidade);
      return { enviado: true, canal_externo: true, vencimento: info.vencimento, valor: info.valor };
    }
    case 'enviar_cnd': {
      if (args.id_condominio) ctx.lastCondo = { id: String(args.id_condominio), nome: ctx.lastCondo?.nome };
      const r = await CND.gerarCndInformativo(args);
      if (!r.ok) return { enviado: false, motivo: r.motivo, ...(r.qtd_cobrancas_em_aberto != null ? { qtd_cobrancas_em_aberto: r.qtd_cobrancas_em_aberto } : {}) };
      if (ctx.chatId) {
        try { await OCTA.enviar_anexo_url({ chatId: ctx.chatId, sourceUrl: r.url, filename: r.filename, body: 'Segue a sua Declaração de Quitação (via informativa) 📄' }); return { enviado: true, tipo: 'informativo' }; }
        catch (e) { return { enviado: false, motivo: 'falha_envio', detalhe: e.message }; }
      }
      (ctx.attachments ||= []).push({ url: r.url, filename: r.filename, kind: 'pdf' });
      return { enviado: true, canal_externo: true, tipo: 'informativo' };
    }
    case 'consultar_regimento': return REG.consultar_regimento(args);
    case 'consultar_base_geral': return BG.consultar_base_geral(args);
    case 'consultar_regra_mudanca': return MUD.consultar_regra_mudanca(args);
    case 'consultar_sistema_portaria': return PORT.consultar_sistema_portaria(args);
    case 'consultar_video_app': return GRUVI.buscar_video(args.assunto);
    case 'consultar_taxa_condominial': return TAXA.consultar_taxa_condominial(args);
    case 'marcar_tag': { if (ctx.chatId) await OCTA.marcar_tag(ctx.chatId, args.tag); return { ok: true }; }
    case 'transferir_humano': { ctx.transferred = { motivo: args.motivo, resumo: args.resumo }; if (ctx.chatId) await OCTA.transferir_humano({ chatId: ctx.chatId, motivo: args.motivo, resumo: args.resumo, fluxo: ctx.fluxo, id_condominio: ctx.lastCondo?.id, nome: ctx.lastCondo?.nome }); return { transferido: true }; }
    case 'criar_rascunho_cadastro': {
      const idc = String(args.id_condominio || ctx.lastCondo?.id || '');
      const idu = String(args.id_unidade || '');
      const r = await ENGINE.criarRascunho('cadastro_inquilino', {
        id_condominio: idc, id_unidade: idu,
        // rótulos p/ a tela do aprovador E p/ o aviso à portaria — do ERP (ctx), não do modelo.
        // O condominio_nome é o que o posGravar usa p/ resolver portaria/síndico: sem ele o aviso
        // não sai. Mapa primeiro (nunca desalinha); lastCondo só como reserva no mesmo turno.
        unidade_label: ctx.unidades?.[idu] || null,
        condominio_nome: ctx.condominios?.[idc] || ctx.lastCondo?.nome || null,
        nome: args.nome, papel: args.papel || 'inquilino', data_entrada: args.data_entrada,
        email: args.email, telefone: args.telefone, cpf: args.cpf,
        responsavel_cobranca: args.responsavel_cobranca,
      }, { solicitante: ctx.solicitante || null, origem: ctx.origem || null });
      if (!r.ok) return { criado: false, motivo: r.motivo, erros: r.erros || [] };
      (ctx.draft ||= []).push({ token: r.token, url: r.urlAprovacao, time: r.time, conflito: r.conflito,
        resumo: `Cadastro de ${args.nome} na unidade ${args.id_unidade}` });
      return { criado: true, protocolo: r.draftId, aguardando_aprovacao: true,
        aviso: r.conflito?.conflito ? 'já existe contato semelhante — a equipe vai conferir' : undefined };
    }
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
  // ⚠️ O `ctx` é NOVO a cada requisição (o /chat-send e o adapter montam um do zero) → o que uma tool
  // guarda nele MORRE no fim do turno. Quem sobrevive entre turnos é a `session` (Redis, 48h).
  // Ancorar o mapa de unidades na sessão (mesma referência) faz o rótulo colhido pelo
  // resolver_cadastro no 1º turno chegar ao criar_rascunho_cadastro lá no 4º — que é o caso real:
  // ninguém identifica a unidade e pede o cadastro na mesma frase.
  // ⚠️⚠️ TEM que ser dentro de `session.ctx`: o saveSession() serializa SÓ {messages, ctx, touched}
  // — qualquer outra chave no topo da sessão é descartada EM SILÊNCIO (foi o que aconteceu, e só o
  // ensaio em prod pegou; teste de unidade não passa pelo save/get).
  session.ctx ||= {};
  ctx.unidades = (session.ctx.unidades ||= {});
  ctx.condominios = (session.ctx.condominios ||= {});
  // Hora real (Brasília) a cada turno: o LLM não tem relógio. Remove o marcador stale do turno anterior
  // (evita "agora são X" antigos acumulados) e injeta o atual logo antes da fala do usuário.
  session.messages = session.messages.filter((m) => !(m.role === 'system' && typeof m.content === 'string' && m.content.startsWith('Contexto temporal')));
  // F4 — poda o histórico ANTES de montar o turno (só quando HIST_CAP está ligado). Roda sobre a
  // conversa JÁ COMPLETA (antes do novo user): stub de tool antigo + cap por turnos. Identidade,
  // user msgs, extra_content e resolver_cadastro ficam intactos (ver history.mjs). No-op se desligado.
  if (HIST_ON) session.messages = podarHistorico(session.messages, { cap: HIST_CAP_N, keepTurns: 2 });
  // Contexto temporal DENTRO da msg do user (não como system separado): mantém o prefixo [system+histórico]
  // 100% estável entre turnos → cache da OpenAI não quebra na fronteira do turno. A 1ª linha (filter acima) segue
  // limpando mensagens temporais legadas de sessões Redis criadas antes desta mudança.
  session.messages.push({ role: 'user', content: `[${agoraContextoTemporal()}] ${userText}` });
  let nudges = 0, emptyRetries = 0;
  // Retry 1x da chamada ao modelo antes de desistir: o gemini-3-flash em function calling solta erros transitórios
  // (ex.: 400 de thought_signature, que o retry de 429/5xx do llm.mjs NÃO cobre) que somem na 2ª tentativa.
  // Cobre o blip intermitente "Desculpa, não consegui processar agora" sem reescrever o fallback. chat() só LÊ
  // session.messages (não muta), então re-chamar é idempotente.
  const callModel = async (lowReasoning) => {
    let lastErr;
    for (let a = 0; a < 4; a++) { // gemini-3 em function-calling solta 400 transitório (thought_signature) que o llm.mjs NÃO re-tenta
      try { return await chat({ messages: session.messages, tools: TOOLS, cacheKey: ctx?.cacheKey, ...(lowReasoning ? { reasoningEffort: 'none' } : {}) }); }
      catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 400 * (a + 1))); }
    }
    console.warn('[blip] callModel esgotou retries:', lastErr?.message);
    throw lastErr;
  };
  for (let i = 0; i < 8; i++) {
    // após uma resposta VAZIA, re-tenta SEM thinking (reasoning_effort:none): os tools já rodaram, só falta compor o
    // texto — desligar o thinking nessa hora destrava o vazio do gemini-3 sem prejudicar a seleção de tools.
    const res = await callModel(emptyRetries > 0);
    // Observabilidade de custo (env-gated, default OFF — igual a DEBUG_LOOP): imprime tokens de prompt
    // e CACHED por chamada. cached_tokens vem na própria resposta (não exige a admin key da Usage API).
    if (process.env.LOG_USAGE && res.usage) {
      console.warn(`[usage] iter=${i} prompt=${res.usage.prompt_tokens} cached=${res.usage.prompt_tokens_details?.cached_tokens ?? '?'} completion=${res.usage.completion_tokens}`);
      (globalThis.__USAGE__ ||= []).push({ prompt: res.usage.prompt_tokens || 0, cached: res.usage.prompt_tokens_details?.cached_tokens || 0, completion: res.usage.completion_tokens || 0 });
    }
    if (res.tool_calls?.length) {
      // PRESERVAR extra_content (thought_signature do gemini-3): sem ele, o modelo perde o raciocínio e devolve
      // VAZIO na hora de compor a resposta após o tool-call (raiz do blip). Devolver a assinatura mata o blip.
      session.messages.push({ role: 'assistant', content: res.content || null, tool_calls: res.tool_calls, ...(res.extra_content ? { extra_content: res.extra_content } : {}) });
      for (const tc of res.tool_calls) {
        // try/catch por tool: uma exceção (timeout de fetch, dado malformado) NÃO pode subir pelo handleTurn e travar o
        // turno — vira { erro } e o modelo compõe um "não consegui consultar agora" no próximo passo (sem hang).
        let out;
        try { out = await runTool(tc.function?.name, safeParse(tc.function?.arguments || '{}'), ctx); }
        catch (e) { console.warn(`[tool] ${tc.function?.name} falhou:`, e?.message); out = { erro: 'falha_ferramenta', detalhe: String(e?.message || e).slice(0, 160) }; }
        session.messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.function?.name, content: JSON.stringify(out) });
      }
      continue;
    }
    let reply = res.content || '';
    if (process.env.DEBUG_LOOP) console.warn(`[loop] iter=${i} toolcalls=${res.tool_calls?.length || 0} contentLen=${(res.content || '').length}`);
    // robustez: o gemini-3 às vezes devolve resposta VAZIA após um tool-call (causa do blip "não consegui processar").
    // Nudge curto + pequeno backoff + até 3 tentativas costuma destravar a composição da resposta antes de desistir.
    if (!reply && !ctx.transferred && emptyRetries < 3) {
      emptyRetries++;
      session.messages.push({ role: 'system', content: 'Escreva AGORA a resposta ao usuário, curta e clara, com base no que as ferramentas já retornaram. Não responda vazio.' });
      await new Promise((r) => setTimeout(r, 400));
      continue;
    }
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
    return { reply, transferred: ctx.transferred || null, attachments: ctx.attachments || [], drafts: ctx.draft || [] };
  }
  return { reply: 'Vou te encaminhar para um atendente.', transferred: ctx.transferred || { motivo: 'nao_resolvido', resumo: 'loop' }, attachments: ctx.attachments || [], drafts: ctx.draft || [] };
}

/**
 * handleTurn(session, userText, ctx) — processa UMA mensagem do contato (piloto: tools reais).
 * ctx: { chatId, fluxo:{botid,componentid,roomkey} }. Retorna { reply, transferred }.
 */
export async function handleTurn(session, userText, ctx) {
  return runAgentLoop(session, SYSTEM_PROMPT, userText, ctx, runToolReal);
}

export { TOOLS, runToolReal };
