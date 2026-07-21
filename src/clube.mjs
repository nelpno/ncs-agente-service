// clube.mjs — consulta o Clube NCS de Vantagens: empresas parceiras e descontos (READ-ONLY, dado estático).
// Fonte: data/clube/empresas.json (extraído de "Tabela das Empresas Gráfica.xlsx" — Fernando, 21/07/2026).
// ⚠️ Diferente de taxa.mjs/mudanca.mjs/regimento.mjs: o Clube NCS é uma lista GLOBAL, igual para TODOS os
// condomínios (não é por condomínio) — não recebe nem filtra por parâmetro de condomínio.
// Anti-alucinação: só devolve o que está no JSON; termo sem correspondência retorna encontrou:false —
// NUNCA inventa empresa, desconto, endereço ou contato.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'data', 'clube', 'empresas.json');

// Regex de diacríticos montada por code point (literal combinante corrompe em Write/Edit no Windows/OneDrive).
const DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g');
const norm = (s) => (s || '')
  .toLowerCase().normalize('NFD').replace(DIACRITICOS, '')
  .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// Sinônimos p/ o vão de vocabulário: o morador fala uma palavra, o dado usa outra (a categoria).
// Só os CLAROS e é extensível; NUNCA mapear pra algo que não é sinônimo de verdade (evita match errado).
const SINONIMOS = { farmacia: 'drogaria', farmacias: 'drogaria', remedio: 'drogaria', remedios: 'drogaria', medicamento: 'drogaria', medicamentos: 'drogaria' };

let _lista = null; // [{nome, categoria, condicao, endereco, contato}]
export function _reloadIndex() { _lista = null; }

function loadLista() {
  if (_lista) return _lista;
  _lista = [];
  if (!fs.existsSync(FILE)) return _lista;
  let data;
  try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return _lista; }
  for (const e of (data.empresas || [])) {
    _lista.push({
      nome: e.nome || '',
      categoria: e.categoria || '',
      condicao: e.condicao || '',
      endereco: e.endereco || '',
      contato: e.contato || '',
    });
  }
  return _lista;
}

/**
 * consultar_clube({ termo })
 * Consulta as empresas parceiras e os descontos do Clube NCS de Vantagens — lista GLOBAL, igual para
 * todos os condomínios (sem filtro por condomínio).
 * Sem termo: devolve a lista resumida (nome + categoria) de todas as empresas cadastradas.
 * Com termo (nome de empresa OU categoria, ex.: "GIOlaser", "Alimentação"): devolve as empresas que
 * casam, com o desconto (condicao) LITERAL, endereço e contato — sem resumir nem parafrasear.
 * Termo sem correspondência -> encontrou:false, motivo:'empresa_nao_encontrada' — NUNCA inventa.
 */
export function consultar_clube({ termo } = {}) {
  const lista = loadLista();
  if (!lista.length) return { encontrou: false, motivo: 'base_clube_vazia' };

  if (!termo || !norm(termo)) {
    return {
      encontrou: true,
      total: lista.length,
      lista: lista.map((e) => ({ nome: e.nome, categoria: e.categoria })),
    };
  }

  const t = norm(termo);
  // expande o termo com sinônimos (ex.: "farmacia" também procura "drogaria")
  const termos = new Set([t]);
  for (const [k, v] of Object.entries(SINONIMOS)) if (t === k || t.includes(k)) termos.add(v);
  const matches = lista.filter((e) => {
    const n = norm(e.nome);
    const c = norm(e.categoria);
    return [...termos].some((tt) => n.includes(tt) || tt.includes(n) || c.includes(tt) || tt.includes(c));
  });

  if (!matches.length) {
    return { encontrou: false, motivo: 'empresa_nao_encontrada', termo_pedido: termo };
  }

  return {
    encontrou: true,
    total: matches.length,
    empresas: matches.map((e) => ({
      nome: e.nome,
      categoria: e.categoria,
      condicao: e.condicao,
      endereco: e.endereco,
      contato: e.contato,
      // texto já formatado (1 campo por linha) — nudge p/ o LLM não devolver tudo corrido numa linha só.
      texto: [
        `${e.nome}${e.categoria ? ` (${e.categoria})` : ''}`,
        `Desconto: ${e.condicao}`,
        e.endereco ? `Endereço: ${e.endereco}` : null,
        e.contato ? `Contato: ${e.contato}` : null,
      ].filter(Boolean).join('\n'),
    })),
  };
}
