// demo_onda1.mjs — DEMONSTRAÇÃO offline do fluxo de cadastro + aviso de portaria (Onda 1).
// Exercita a lógica REAL da action (validar/montarPayload/checarConflito/gravar/posGravar) com STUBS
// (sem rede, sem tocar Superlógica). Serve pra mostrar ao Fernando o "antes → depois" na prática.
// Rodar: node test/demo_onda1.mjs
import { cadastroInquilino as A } from '../src/write/actions/cadastro_inquilino.mjs';
import { planejarAviso } from '../src/portaria_dispatch.mjs';
import { planejarAvisoGarantidora } from '../src/garantidora_dispatch.mjs';
import { mailerStatus } from '../src/mailer.mjs';

// STUBS (simulam o Superlógica em modo seguro)
const ioSemConflito = {
  responsaveisIndex: async () => [], // unidade sem contato igual
  slPut: async () => ({ ok: true, dryRun: true, resposta: '(gravação SIMULADA — DRY_RUN)' }),
};

const CENARIOS = [
  {
    titulo: 'Novo INQUILINO no Aristocrata (portaria Alarm System)',
    hoje: 'Jussara digita no Superlógica → digita de novo no e-mail da portaria Alarm System → torce pra não errar o CPF.',
    dados: { id_condominio: '101', id_unidade: '5001', condominio_nome: 'Aristocrata', unidade_label: 'Apto 42',
             nome: 'Maria Silva', papel: 'inquilino', data_entrada: '07/15/2026', cpf: '123.456.789-00',
             email: 'maria@email.com', telefone: '16 99999-1111' },
  },
  {
    titulo: 'Novo INQUILINO no Lume (portaria Shielder)',
    hoje: 'Digita no Superlógica → replica no app Shielder na mão.',
    dados: { id_condominio: '179', id_unidade: '7002', condominio_nome: 'Lume', unidade_label: 'Apto 13B',
             nome: 'João Souza', papel: 'inquilino', data_entrada: '07/15/2026', cpf: '987.654.321-00',
             email: 'joao@email.com', telefone: '16 98888-2222' },
  },
  {
    titulo: 'Novo DEPENDENTE no Amarige (portaria GatWay)',
    hoje: 'Digita no Superlógica. (Portaria GatWay a NCS não precisa avisar — mas hoje ela nem sempre sabe disso.)',
    dados: { id_condominio: '177', id_unidade: '3003', condominio_nome: 'Amarige', unidade_label: 'Casa 7',
             nome: 'Ana Costa', papel: 'dependente', data_entrada: '07/15/2026', cpf: '111.222.333-44' },
  },
  {
    titulo: 'Novo INQUILINO no Atlanta (portaria "pessoa" — Tiago)',
    hoje: 'Digita no Superlógica → manda os dados pro Tiago (conhecimento que só a Jussara tem).',
    dados: { id_condominio: '205', id_unidade: '9004', condominio_nome: 'Atlanta', unidade_label: 'Apto 101',
             nome: 'Carlos Lima', papel: 'inquilino', data_entrada: '07/15/2026', cpf: '222.333.444-55',
             email: 'carlos@email.com', telefone: '16 97777-3333' },
  },
];

const L = (s = '') => console.log(s);
const canalLabel = { zap_grupo: '💬 WhatsApp (grupo da portaria)', zap_individual: '💬 WhatsApp', email: '📧 e-mail', web_form: '🌐 formulário web', nenhum: '⏭️ nenhum' };

for (const c of CENARIOS) {
  L('\n══════════════════════════════════════════════════════════════════');
  L('▶ ' + c.titulo);
  L('══════════════════════════════════════════════════════════════════');
  L('HOJE (manual): ' + c.hoje);
  L('');

  const v = A.validar(c.dados);
  if (!v.ok) { L('❌ dados inválidos: ' + v.erros.join(', ')); continue; }

  const conflito = await A.checarConflito({}, c.dados, ioSemConflito);
  const payload = A.montarPayload(c.dados);
  const grav = await A.gravar(payload, { dados: c.dados, io: ioSemConflito });
  // Avisos: planejarAviso é async (contatos podem vir do Supabase). posGravar (no fluxo real) enfileira
  // esse mesmo plano no outbox; aqui exibimos o plano diretamente pra mostrar os destinos.
  const av = await planejarAviso({ evento: 'cadastro', condominio: c.dados.condominio_nome,
    ator: { nome: c.dados.nome, papel: c.dados.papel, unidade: c.dados.unidade_label, telefone: c.dados.telefone } });

  L('COM A IA (novo fluxo):');
  L(`  1) Morador pede no WhatsApp → a Ana já monta o cadastro.`);
  L(`  2) A equipe vê no painel e APROVA (1 clique). Duplicidade? ${conflito.conflito ? 'SIM — alerta' : 'não — unidade limpa'}.`);
  L(`  3) Grava no Superlógica: ${grav.ok ? (grav.dryRun ? 'OK (simulado)' : 'OK') : 'ERRO'}`);
  L(`     → papel=${payload['contatos[0][ID_LABEL_TRES]'] === '4' ? 'dependente' : 'inquilino'}, nome="${c.dados.nome}"`);
  if (!av.ok) {
    L(`  4) Avisos automáticos: condomínio não resolvido (${av.motivo}) → vai pra fila de pendências (não esquece).`);
  } else {
    L(`  4) Avisos automáticos (${av.sistema} · portaria ${av.tipo_portaria}):`);
    for (const d of av.destinos) {
      const st = d.status === 'pronto' ? '✅ pronto' : '🙋 falta o contato → vai pra fila (não esquece)';
      const via = d.via ? ` (${d.via})` : '';
      const end = d.endereco ? ` → ${d.endereco}` : '';
      L(`     • ${d.papel}${via}: ${canalLabel[d.canal] || d.canal}${end} — ${st}`);
    }
  }
}
// ── Cenário de TITULARIDADE (garantidora) ──
L('\n══════════════════════════════════════════════════════════════════');
L('▶ Troca de TITULARIDADE no Vale Supremo (condomínio com garantidora)');
L('══════════════════════════════════════════════════════════════════');
L('HOJE (manual): a recepção atualiza o cadastro E lembra de encaminhar o documento pro e-mail da garantidora (só a Jussara sabe que o Vale Supremo é assim).');
L('');
const gpl = planejarAvisoGarantidora({ id_condominio: 186, condominio_nome: 'Vale Supremo', documento: 'Escritura Pública',
  morador: { nome: 'Roberto Nunes', unidade: 'Apto 55', cpf: '333.444.555-66', email: 'roberto@email.com', telefone: '16 96666-4444' } });
L('COM A IA (novo fluxo):');
L(`  1) Atualiza a titularidade no Superlógica (com aprovação da equipe).`);
L(`  2) Garantidora: ${gpl.garantidora} (${gpl.tipo}) → ${gpl.acao === 'enviar_email' ? '📧 E-MAIL AUTOMÁTICO' : gpl.acao}`);
if (gpl.email) {
  L(`     → Para: ${gpl.email.para}`);
  L(`     → Assunto: ${gpl.email.assunto}`);
  L(`     → encaminha os dados do novo proprietário sozinho (a garantidora é quem emite o boleto).`);
}

// ── Status do envio real de e-mail ──
const ms = mailerStatus();
L('\n──────────────────────────────────────────────────────────────────');
L(`✉️  Envio de e-mail: ${ms.habilitado ? 'LIGADO (' + ms.from + ')' : 'PRONTO, porém em SIMULAÇÃO'} — liga quando o atendimentoncs@gruponcs.net existir (basta setar as envs SMTP).`);
L('\n✅ Demo concluído. Nada foi gravado nem enviado de verdade (tudo DRY_RUN / stub).');
