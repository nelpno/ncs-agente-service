// dedupe_rascunho.mjs — um cadastro, um card. A decisão é PURA e mora aqui para ter teste próprio;
// quem faz a gravação (expirar o anterior, fechar a linha da fila) é o chamador.
//
// POR QUE EXISTE: no stress de 08/08 uma conversa preparou o MESMO cadastro duas vezes (dois cards do
// Fabrício Nery Bandeira, 12 s de diferença). Não é caso de laboratório — na fila real de 07/08 a
// Maria Poliana tinha 2 rascunhos do mesmo cadastro. Com `WRITE_REAL_ACTIONS` ligado e os dois
// aprovados, é a mesma pessoa cadastrada 2× na unidade.
//
// ⚠️ O cenário feito de propósito para isso (mandar o cadastro 2× de propósito) passou 3/3 — o modelo
// acerta quase sempre. "Quase" é o que precisa de código: prompt não dá garantia, teto dá.
//
// 🔑 SUBSTITUI, não bloqueia. Bloquear o 2º card manteria o 1º — e o 2º pode ser a CORREÇÃO de um dado
// (a pessoa muda a data depois de a Ana já ter preparado). Quem vale é sempre o mais novo.

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '').replace(/\s+/g, ' ').trim();

// Identidade do cadastro DENTRO de uma conversa: mesma unidade + mesma pessoa + mesmo papel.
// O condomínio não entra porque a unidade já é única no ERP; o papel entra porque cadastrar a mesma
// pessoa como inquilino E como dependente na mesma unidade é pedido diferente, não duplicata.
export function chaveDoCadastro({ id_unidade, nome, papel } = {}) {
  return `${String(id_unidade || '')}|${norm(nome)}|${norm(papel) || 'inquilino'}`;
}

/**
 * Registra o rascunho recém-criado na conversa e diz qual anterior deve ser expirado.
 * Muta `sessionCtx` (é o mesmo objeto que vai para o Redis, como o `handoffFilaFeito`).
 * @returns {{expirar: string|null, chave: string}} `expirar` = draftId anterior do MESMO cadastro
 */
export function registrarRascunho(sessionCtx, dados, novoDraftId) {
  const chave = chaveDoCadastro(dados);
  if (!sessionCtx || !novoDraftId) return { expirar: null, chave };
  const mapa = (sessionCtx.rascunhosCadastro ||= {});
  const anterior = mapa[chave] || null;
  mapa[chave] = novoDraftId;
  // Nunca devolver o próprio id: se o mesmo rascunho for registrado 2× (retry do chamador), expirar
  // o "anterior" apagaria o card que acabou de nascer.
  return { expirar: anterior && anterior !== novoDraftId ? anterior : null, chave };
}

// Kill-switch. Ligado por padrão; existe para permitir A/B honesto sem rebuild — com a flag off o
// comportamento é byte-idêntico ao de antes (o chamador nem chama).
export const dedupeAtivo = () => process.env.DEDUPE_RASCUNHO !== '0';
