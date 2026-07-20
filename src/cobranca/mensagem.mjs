// mensagem.mjs — compositor da mensagem de cobrança (assunto + corpo) a partir de um template + dados da unidade.
// LGPD (Fable): o ASSUNTO nunca traz valor/dívida (o corpo, sim, só ao titular). Placeholders {{...}} → dados.
// PURO/testável: recebe o template como string (a leitura do arquivo é `carregarTemplate`, camada fina).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Assunto por etapa — NEUTRO (sem valor, sem "dívida"); escala no tom. {{condominio}}/{{unidade}} são substituídos.
export const ASSUNTOS = {
  1: 'Comunicado — {{condominio}} (unidade {{unidade}})',
  2: 'Reiteração de comunicado — {{condominio}} (unidade {{unidade}})',
  3: 'Comunicado final — {{condominio}} (unidade {{unidade}})',
};

/** formatBRL(n) → "1.270,80" (pt-BR, 2 casas). */
export function formatBRL(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// substitui {{chave}} pelos valores; chave ausente/nula → '' (nunca deixa {{}} nem 'undefined').
function preencher(tpl, vars) {
  return String(tpl).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
}

/**
 * comporMensagem(dados, templateText) → { assunto, corpo }
 * dados: { nome, condominio, unidade, valor_corrigido, vencimento, link_2via, pix, etapa }
 * O valor é formatado (formatBRL) e exposto como {{valor}}. O assunto vem de ASSUNTOS[etapa] (sem valor).
 */
export function comporMensagem(dados = {}, templateText = '') {
  const etapa = Number(dados.etapa) || 1;
  const vars = {
    nome: dados.nome, condominio: dados.condominio, unidade: dados.unidade,
    valor: formatBRL(dados.valor_corrigido), vencimento: dados.vencimento,
    link_2via: dados.link_2via, pix: dados.pix,
  };
  const assuntoTpl = ASSUNTOS[etapa] || ASSUNTOS[1];
  return { assunto: preencher(assuntoTpl, vars), corpo: preencher(templateText, vars) };
}

/** carregarTemplate(etapa) → string do arquivo data/templates/cobranca-etapa<etapa>.md (camada fina, não-pura). */
export function carregarTemplate(etapa) {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'templates');
  return fs.readFileSync(path.join(dir, `cobranca-etapa${Number(etapa) || 1}.md`), 'utf8');
}
