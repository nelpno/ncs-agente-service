// pii_ata.mjs — tira CPF e RG do texto de ATA antes de o documento entrar no RAG.
//
// Ata de assembleia qualifica quem presidiu e quem secretariou com nome + RG + CPF + endereço. Isso
// entra na mesma base que a Ana consulta para responder morador. Nome e unidade PRECISAM ficar (a ata
// não faz sentido sem dizer quem decidiu o quê); documento de identidade, não.
//
// ⚠️ Este mascarador tem de errar para o lado de PRESERVAR: valor em reais, percentual, data, CNPJ do
// condomínio, CEP, número de lei e de artigo são exatamente o conteúdo útil da ata. Um regex ganancioso
// de "sequência de dígitos com pontos" comeria R$ 101.893,87 e a Lei 4.591/64 junto com o CPF — e o
// resultado continuaria parecendo uma ata. Por isso cada padrão aqui é ancorado no RÓTULO (CPF/RG).
const MARCA = '[removido]';

// CPF: só quando vem anunciado como CPF. Aceita 000.000.000-00 e 00000000000.
const CPF_ROTULADO = /\bCPF\b([^0-9\n]{0,20})(\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11})/gi;
// RG: idem. O RG brasileiro varia muito (com/sem dígito verificador, com/sem pontos) — por isso o
// rótulo é obrigatório. O `\s*-\s*` no fim existe porque a ata do Vancouver traz "RG n° 8169562 -7",
// com espaço ANTES do hífen: sem isso o dígito verificador ficava órfão como " -7" depois do corte.
const RG_ROTULADO = /\bRG\b([^0-9\n]{0,20})(\d{1,3}(?:\.\d{3}){1,3}(?:\s*-\s*[0-9A-Za-z])?|\d{7,11}(?:\s*-\s*[0-9A-Za-z])?)/gi;

/**
 * mascararPII(texto) → texto com CPF/RG substituídos por "[removido]".
 * Mantém o rótulo ("portador do CPF sob n.º [removido]") para que o leitor humano saiba que ali havia
 * um documento — apagar sem marca esconde a edição e atrapalha quem for conferir contra o original.
 */
export function mascararPII(texto) {
  if (!texto) return texto;
  return String(texto)
    .replace(CPF_ROTULADO, (_m, meio) => `CPF${meio}${MARCA}`)
    .replace(RG_ROTULADO, (_m, meio) => `RG${meio}${MARCA}`);
}

/**
 * _temPII(texto) → true se ainda houver CPF/RG rotulado. Serve de GUARD na ingestão: se sobrar,
 * aborta o arquivo em vez de gravar. Detector e mascarador compartilham os mesmos padrões de
 * propósito — se um mudar sem o outro, o teste dos dois lados acusa.
 */
export function _temPII(texto) {
  if (!texto) return false;
  CPF_ROTULADO.lastIndex = 0;
  RG_ROTULADO.lastIndex = 0;
  return CPF_ROTULADO.test(String(texto)) || RG_ROTULADO.test(String(texto));
}
