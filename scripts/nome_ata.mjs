// nome_ata.mjs — converte o nome do arquivo como ele vem do Drive no nome que o retriever entende.
//
// O retriever tira a DATA do nome do arquivo (regimento.mjs → extrairDataAta) e é ela que faz "a
// última assembleia sobrepõe" funcionar. No Drive os arquivos vêm com a data por extenso e em
// português — "AGO - 08 DE NOVEMBRO DE 2021.pdf" —, então a conversão é o elo entre uma coisa e
// outra. Nome que não vira data entra como ATA sem data e vai para o FIM da ordenação, calado:
// por isso `nomeArquivoAta` devolve o motivo, e quem ingere tem de tratar a lista de recusados.
//
// Funções puras, sem I/O — o teste roda no CI sem tocar disco nem rede.

const MESES = {
  janeiro: 1, fevereiro: 2, marco: 3, março: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};

const semAcento = (s) => String(s).normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');

// ⚠️ "AGO" é ambíguo: no nome dessas atas ele quase sempre é Assembleia Geral Ordinária, não agosto.
// Por isso o mês por extenso só é aceito quando vem cercado de "DE" ("08 DE AGOSTO DE 2021") — a
// sigla solta no começo do nome é ignorada. Sem isso, "AGO - 08 DE NOVEMBRO DE 2021" viraria agosto.
const TIPO_ASSEMBLEIA = /^\s*(AG[OEI]|AGO|AGE|AGI|ASSEMBLEIA[^-\d]*)[\s\-–—:]+/i;

/**
 * dataDoNome(nome) → 'AAAA-MM-DD' | null
 * Aceita, em ordem: AAAA-MM-DD · DD/MM/AAAA e DD-MM-AAAA · DD de MÊS de AAAA · DD.MM.AAAA
 */
export function dataDoNome(nome) {
  const cru = String(nome || '').replace(/\.[a-z0-9]+$/i, '');       // tira a extensão
  const s = semAcento(cru).replace(TIPO_ASSEMBLEIA, ' ');            // tira a sigla do tipo
  const iso = (a, m, d) => {
    const A = Number(a), M = Number(m), D = Number(d);
    if (!A || !M || !D || M < 1 || M > 12 || D < 1 || D > 31) return null;
    if (A < 1990 || A > 2100) return null;
    const dt = new Date(A, M - 1, D);
    if (dt.getFullYear() !== A || dt.getMonth() !== M - 1 || dt.getDate() !== D) return null; // 31/02
    return `${A}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`;
  };

  let m;
  if ((m = s.match(/(\d{4})[-_.](\d{1,2})[-_.](\d{1,2})/))) return iso(m[1], m[2], m[3]);
  if ((m = s.match(/(\d{1,2})\s*(?:de\s*)?([a-z]{3,9})\s*(?:de\s*)?(\d{4})/i))) {
    const mes = MESES[m[2].toLowerCase()];
    if (mes) return iso(m[3], mes, m[1]);
  }
  if ((m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/))) return iso(m[3], m[2], m[1]);
  return null;
}

/**
 * nomeArquivoAta(nomeNoDrive) → { ok, arquivo?, data?, motivo? }
 * `arquivo` é sempre 'ata-AAAA-MM-DD.md'.
 */
export function nomeArquivoAta(nomeNoDrive) {
  const data = dataDoNome(nomeNoDrive);
  if (!data) return { ok: false, motivo: 'sem_data_no_nome' };
  return { ok: true, arquivo: `ata-${data}.md`, data };
}

/**
 * jaExiste(arquivo, existentes) → true se aquela DATA já está ingerida naquele condomínio.
 * Compara por data, não por nome inteiro: 6 dos ~55 condomínios já tinham ata em disco antes do
 * lote (Allure, Lume, Moove, Studio Five, Vida Plena, Dom Pedro) e o Drive traz as mesmas — sem
 * isto a mesma assembleia entraria duas vezes e disputaria as vagas do top-k contra si mesma.
 */
export function jaExiste(arquivo, existentes = []) {
  const d = dataDoNome(arquivo);
  if (!d) return false;
  return existentes.some((e) => dataDoNome(e) === d);
}
