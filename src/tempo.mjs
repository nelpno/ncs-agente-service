// tempo.mjs — contexto temporal injetado a cada turno.
// O LLM não tem relógio próprio: sem isto ele "chuta" o período do dia (ex.: "Bom dia" às 20h).
// Calcula a hora REAL de Brasília (America/Sao_Paulo) para: (1) saudação correta
// (Bom dia/Boa tarde/Boa noite) e (2) saber se o atendimento humano está aberto (seg–sex, 8h–17h45).
// `now` é injetável só para teste; em produção usa o relógio real.
export function agoraContextoTemporal(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', weekday: 'long',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  let hora = parseInt(p.hour, 10); if (hora === 24) hora = 0; // Intl pode devolver "24" à meia-noite
  const min = parseInt(p.minute, 10);
  const saud = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const fimDeSemana = /s[áa]bado|domingo/i.test(p.weekday);
  const mins = hora * 60 + min;
  const aberto = !fimDeSemana && mins >= 480 && mins <= 1065; // 08:00–17:45
  const hh = String(hora).padStart(2, '0');
  return `Contexto temporal (NÃO repita isto ao usuário nem cite a hora; use só para agir certo): agora são ${hh}:${p.minute} de ${p.weekday}, ${p.day}/${p.month}/${p.year} (horário de Brasília). Saudação correta para ESTE horário: "${saud}" — use esta, nunca presuma o período do dia. Atendimento humano: seg–sex, 8h às 17h45; agora está ${aberto ? 'ABERTO' : 'FECHADO'}.`;
}
