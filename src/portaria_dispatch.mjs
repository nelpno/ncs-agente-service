// portaria_dispatch.mjs — PLANEJA os avisos de um evento (cadastro/titularidade/mudança) para a portaria + síndico.
// Redesenhado (revisão Fable + feedback Fernando 11/07): chaveia por tipo_portaria (Humana/Virtual/Hibrida),
// NÃO por sistema de acesso; e é MULTI-DESTINO (o síndico recebe SEMPRE). "Shielder" é app de acesso, não canal.
// NÃO envia nada: devolve destinos[] com canal + endereço + status. O envio real é do outbox.mjs.
// Endereços vêm de condominio_contatos.mjs (agnóstico à fonte: hoje JSON/Supabase, ver spec §4.2).
// Texto do aviso vem de templates.mjs (data/templates/<evento>-<papel>.md), fora do código (spec §4.5).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolverContatos } from './condominio_contatos.mjs';
import { renderTemplate } from './templates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const D = path.join(__dirname, '..', 'data', 'portaria');
const P_SISTEMAS = path.join(D, 'sistemas-portaria.json');
const P_REGRAS = path.join(D, 'canais-dispatch.json');

const norm = (s) => (s || '').toLowerCase().normalize('NFD')
  .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
  .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

let _condos = null, _regras = null;
export function _reload() { _condos = _regras = null; }
function load() {
  if (!_condos) _condos = (JSON.parse(fs.readFileSync(P_SISTEMAS, 'utf8')).condominios) || [];
  if (!_regras) _regras = JSON.parse(fs.readFileSync(P_REGRAS, 'utf8'));
  return { condos: _condos, regras: _regras };
}

function resolveCondo(condos, condominio) {
  if (!norm(condominio)) return null;
  const c = norm(condominio);
  const nomesDe = (x) => [x.nome, ...(x.aliases || [])].map(norm).filter(Boolean);
  const exato = condos.filter((x) => x.slug === c || nomesDe(x).includes(c));
  if (exato.length === 1) return exato[0];
  if (exato.length > 1) return null;
  const subs = condos.filter((x) => nomesDe(x).some((n) => n.includes(c) || c.includes(n)) || norm((x.slug || '').replace(/-/g, ' ')).includes(c));
  return subs.length === 1 ? subs[0] : null;
}

// Precedência: override_condominio > excecao_sistema > default_do_tipo_portaria.
function regrasDestino(condo, regras) {
  const ov = regras.overrides_condominio?.[condo.slug];
  if (ov) return ov;
  const ex = regras.excecoes_sistema?.[condo.sistema];
  if (ex) return ex;
  return regras.defaults_por_tipo?.[condo.tipo_portaria] || regras.defaults_por_tipo?.Humana || [];
}

// Resolve o endereço de um destino a partir dos contatos já resolvidos do condo (+ e-mail de sistema conhecido).
function resolverEndereco(condo, papel, canal, regras, contatosCondo) {
  const c = contatosCondo || {};
  if (papel === 'sindico') return c.sindico_whatsapp || null;
  if (papel === 'portaria') {
    if (canal === 'zap_grupo') return c.portaria_grupo_jid || null;
    if (canal === 'email') return c.portaria_email || regras.enderecos_sistema?.[condo.sistema]?.portaria_email || null;
    if (canal === 'zap_individual') return c.pessoa_whatsapp || null;
  }
  return null;
}

// A API do Superlógica fala MM/DD/AAAA; gente lê DD/MM/AAAA. Só exibição — o payload do ERP não muda.
const dataBR = (s) => {
  const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[2]}/${m[1]}/${m[3]}` : (s || '');
};

function varsDoTexto(evento, ator, condo) {
  const quem = ator.papel === 'dependente' ? 'dependente' : (ator.papel || 'morador');
  return {
    papel: quem, nome: ator.nome || '', unidade: ator.unidade || '', condominio: condo.nome,
    telefone: ator.telefone || '',
    // Pedido do Fernando (15/07, no grupo de teste): a portaria precisa saber QUANDO a pessoa entra.
    // ⚠️ É a data de ENTRADA do cadastro, não a data da MUDANÇA — mudança tem fluxo próprio
    // (formulário de agendamento) e pode ser outro dia. Rotular uma como a outra faria a portaria
    // se planejar para o dia errado; por isso o template diz "Data de entrada".
    data: dataBR(ator.data),
  };
}

/**
 * planejarAviso({ evento, condominio, ator, contatos? }) → { ok, condominio, tipo_portaria, sistema, destinos[] }
 *  destinos[i] = { papel:'portaria'|'sindico', canal:'zap_grupo'|'zap_individual'|'email'|'nenhum', via?, endereco|null, status:'pronto'|'sem_contato', payload }
 * Não resolve o condo → { ok:false, motivo:'condominio_nao_resolvido' }.
 * ASSÍNCRONA (contatos podem vir do Supabase). `contatos` (opcional, mapa {slug:{...}}) permite injetar em
 * teste sem tocar condominio_contatos.mjs; default = resolverContatos(condo.slug).
 */
export async function planejarAviso({ evento = 'cadastro', condominio, ator = {}, contatos } = {}) {
  const { condos, regras } = load();
  const condo = resolveCondo(condos, condominio);
  if (!condo) return { ok: false, motivo: 'condominio_nao_resolvido', condominio };

  const contatosCondo = contatos ? (contatos[condo.slug] || {}) : ((await resolverContatos(condo.slug)) || {});
  const vars = varsDoTexto(evento, ator, condo);
  const regrasD = regrasDestino(condo, regras);
  const destinos = regrasD.map((r) => {
    const endereco = resolverEndereco(condo, r.papel, r.canal, regras, contatosCondo);
    return {
      papel: r.papel, canal: r.canal, via: r.via || null,
      endereco: endereco || null,
      status: endereco ? 'pronto' : 'sem_contato',
      payload: renderTemplate({ evento, papel: r.papel, vars }),
    };
  });
  return { ok: true, condominio: condo.nome, tipo_portaria: condo.tipo_portaria, sistema: condo.sistema, destinos };
}
