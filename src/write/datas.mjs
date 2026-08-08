// datas.mjs — converte a data COMO A PESSOA FALA (BR) para o formato que a API do Superlógica exige.
//
// 🔴 Por que isto é código e não instrução de prompt: no teste dos 20 cadastros (07/08/2026) a
// conversão era feita pelo MODELO e falhou em 1 de 20. O caso 16 informou "entrada em 05/08/2026"
// (5 de agosto) e o rascunho gravou `05/08/2026` num campo que o ERP lê como MM/DD → 8 de MAIO.
// A falha é SILENCIOSA: o card exibe uma data plausível, o aprovador não tem como desconfiar, e a
// data de entrada vai para o contrato e para o aviso da portaria. Intermitente (5%) é pior que
// determinístico — dá a impressão de que funciona.
//
// Contrato novo: a tool recebe DD/MM/AAAA (ou ISO, ou por extenso) e QUEM CONVERTE É AQUI.
// Ver test/test_datas_br.mjs — todo formato aceito e todo formato recusado estão lá.
//
// ⚠️ Regra que não pode ser afrouxada: entrada que não seja uma data válida é RECUSADA, nunca
// chutada. Uma data errada entra calada; um erro faz a Ana perguntar de novo.

const semAcento = (s) => String(s).normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');

const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Nome do mês em português → 1-12 (null se não for mês). Aceita com e sem acento/maiúscula. */
export function _mesPorNome(nome) {
  const i = MESES.indexOf(semAcento(nome).toLowerCase().trim());
  return i === -1 ? null : i + 1;
}

// Existe de verdade no calendário? Constrói em UTC e confere se o Date não "rolou" o excesso
// (31/02 vira 03/03 em JS, calado — é isso que este check pega, inclusive o 29/02 fora de bissexto).
function dataExiste(dia, mes, ano) {
  if (!(dia >= 1 && dia <= 31) || !(mes >= 1 && mes <= 12) || !(ano >= 1900 && ano <= 2200)) return false;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

const pad = (n) => String(n).padStart(2, '0');
const apiFmt = (dia, mes, ano) => `${pad(mes)}/${pad(dia)}/${ano}`;

/**
 * paraDataApi — "05/08/2026" → { ok:true, data:"08/05/2026" }.
 *
 * Aceita: DD/MM/AAAA (com / - .), ISO AAAA-MM-DD, e "DD de <mês> de AAAA".
 * Recusa: sem ano, ano de 2 dígitos, data inexistente e qualquer coisa que não seja data.
 *
 * @returns {{ok:true, data:string} | {ok:false, motivo:string}}
 */
export function paraDataApi(entrada) {
  if (typeof entrada !== 'string') return { ok: false, motivo: 'data_ausente' };
  const txt = entrada.trim();
  if (!txt) return { ok: false, motivo: 'data_ausente' };

  // ISO (AAAA-MM-DD): não é ambíguo, então é lido como ISO e não como BR.
  const iso = txt.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [, ano, mes, dia] = iso.map(Number);
    return dataExiste(dia, mes, ano) ? { ok: true, data: apiFmt(dia, mes, ano) } : { ok: false, motivo: 'data_inexistente' };
  }

  // Por extenso: "10 de agosto de 2026". SEM ano é recusado de propósito — deduzir o ano é chutar.
  const ext = txt.match(/^(\d{1,2})\s+de\s+([A-Za-zÀ-ÿ]+)\s+de\s+(\d{4})$/i);
  if (ext) {
    const dia = Number(ext[1]);
    const mes = _mesPorNome(ext[2]);
    const ano = Number(ext[3]);
    if (!mes) return { ok: false, motivo: 'mes_por_extenso_desconhecido' };
    return dataExiste(dia, mes, ano) ? { ok: true, data: apiFmt(dia, mes, ano) } : { ok: false, motivo: 'data_inexistente' };
  }

  // Numérico com separador. O ano precisa ter 4 dígitos: "05/08/26" pode ser 1926 ou 2026 — para
  // data de nascimento a diferença é de um século, e este módulo é o mesmo dos dois campos.
  const num = txt.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!num) return { ok: false, motivo: 'formato_nao_reconhecido' };
  const a = Number(num[1]), b = Number(num[2]), ano = Number(num[3]);

  // Rede de segurança da virada de contrato: se o 2º campo não cabe como MÊS (>12) mas o 1º cabe,
  // a única leitura possível é MM/DD — é o modelo mandando no formato antigo. Aceita, porque não há
  // ambiguidade nenhuma nesse caso; jamais quando os dois cabem como mês (que é onde o bug nasceu).
  if (b > 12 && a <= 12) {
    return dataExiste(b, a, ano) ? { ok: true, data: apiFmt(b, a, ano) } : { ok: false, motivo: 'data_inexistente' };
  }
  return dataExiste(a, b, ano) ? { ok: true, data: apiFmt(a, b, ano) } : { ok: false, motivo: 'data_inexistente' };
}

// Mensagem para a Ana repassar quando a data não converte. Fica junto da regra (e não espalhada
// pelo agent.mjs) para que os dois campos de data digam a mesma coisa.
export const MOTIVO_TEXTO = {
  data_ausente: 'a data não foi informada',
  formato_nao_reconhecido: 'não entendi a data — peça no formato dia/mês/ano (ex.: 05/08/2026)',
  mes_por_extenso_desconhecido: 'não reconheci o mês — peça a data no formato dia/mês/ano',
  data_inexistente: 'essa data não existe no calendário — confirme o dia, o mês e o ano',
};

/** Converte o campo `campo` de `alvo` no lugar. Devolve o erro pronto quando a data não é válida. */
export function converterCampoData(alvo, campo, rotulo) {
  if (alvo[campo] == null || alvo[campo] === '') return null;
  const r = paraDataApi(alvo[campo]);
  if (!r.ok) return `${rotulo}: ${MOTIVO_TEXTO[r.motivo] || 'data inválida'}`;
  alvo[campo] = r.data;
  return null;
}
