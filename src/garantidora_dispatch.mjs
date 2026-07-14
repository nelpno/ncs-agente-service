// garantidora_dispatch.mjs — PLANEJA o aviso à garantidora numa TROCA DE TITULARIDADE (side-effect da Onda 2).
// Nos condos 'total', a garantidora emite os boletos → precisa receber os dados/documentos do novo proprietário.
// Reusa consultar_garantidora (isolado, anti-alucinação). NÃO envia nada — devolve o plano. Envio real via mailer.mjs.
import { consultar_garantidora } from './garantidora.mjs';

function corpoGarantidora(morador, g, documento) {
  return [
    `Prezados,`,
    ``,
    `Informamos uma atualização de titularidade no condomínio ${g.condominio}, para providências de cobrança:`,
    ``,
    `Novo proprietário: ${morador.nome || '—'}`,
    morador.unidade ? `Unidade: ${morador.unidade}` : null,
    // LGPD (Fernando 13/07/2026): o aviso à portaria/garantidora vai só com nome + unidade — NÃO enviar CPF.
    morador.email ? `E-mail: ${morador.email}` : null,
    morador.telefone ? `Telefone: ${morador.telefone}` : null,
    ``,
    documento ? `Documento comprobatório: ${documento}.` : `Documento comprobatório segue conforme combinado.`,
    ``,
    `Atenciosamente,`,
    `Grupo NCS — Administradora de Condomínios e Associações.`,
  ].filter((l) => l !== null).join('\n');
}

/**
 * planejarAvisoGarantidora({ id_condominio, condominio_nome, morador, documento })
 *  - total + e-mail → acao 'enviar_email' (encaminha os dados/doc do novo proprietário).
 *  - allure         → acao 'nenhuma' (boleto é normal pela NCS; só inadimplência vai à garantidora).
 *  - sem garantidora→ acao 'nenhuma'.
 *  - total sem e-mail→ acao 'pendente_humano' (não falha calado).
 */
export function planejarAvisoGarantidora({ id_condominio, condominio_nome, morador = {}, documento = null } = {}) {
  const g = consultar_garantidora({ id_condominio, nome: condominio_nome });
  if (!g.tem) return { ok: true, tem: false, acao: 'nenhuma', nota: 'condomínio sem garantidora — cobrança normal pela NCS' };

  const email = g.garantidora?.email || null;
  const base = { ok: true, tem: true, tipo: g.tipo, condominio: g.condominio, garantidora: g.garantidora?.nome || null };

  if (g.tipo === 'allure') return { ...base, acao: 'nenhuma', nota: 'Allure: cadastro/boleto normal pela NCS; só a inadimplência (+30d) vai à garantidora' };

  if (g.tipo === 'total' && email && /@/.test(email)) {
    return {
      ...base, acao: 'enviar_email',
      email: {
        para: email,
        assunto: `Atualização de titularidade — ${g.condominio}${morador.nome ? ' — ' + morador.nome : ''}`,
        corpo: corpoGarantidora(morador, g, documento),
      },
    };
  }
  return { ...base, acao: 'pendente_humano', canal_email: email, nota: 'garantidora sem e-mail válido cadastrado — equipe encaminha' };
}
