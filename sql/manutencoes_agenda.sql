-- Agenda de MANUTENÇÕES PROGRAMADAS (extintor, AVCB, caixa d'água, seguros, gás...) por condomínio.
-- Aplicado no Supabase do NCS (dcirzddyoctxugfowvob) via migração `create_manutencoes_agenda` (24/07/2026).
--
-- ⚠️ Este dado NÃO existe na API pública v2 — só no painel admin (admgrupo.superlogica.net), que exige
-- sessão com MFA. Por isso o espelho: scripts/sync_manutencoes.mjs captura (Playwright + cookie salvo,
-- roda na máquina do Nelson, cadência semanal) e grava aqui; o Resumo Financeiro (Card 2) só LÊ.
-- Se a captura envelhecer, o card mostra a data do último snapshot — nunca quebra o Resumo.
--
-- Uma linha por (condomínio × categoria × mês). Backend-only (service_role), deny-all.
-- Zero PII: é cronograma de manutenção predial.
create table if not exists manutencoes_agenda (
  id uuid primary key default gen_random_uuid(),
  id_condominio int not null,          -- id do Superlógica (casado por nome exato no sync)
  condominio_painel text not null,     -- nome como aparece no painel admin
  categoria_id text not null,          -- id_manutencoes_mt (ex.: 1001 Extintores, 4 AVCB)
  categoria text not null,             -- st_nome_mt (nome completo)
  ano int not null,
  mes int not null,                    -- 1..12
  dia int,                             -- quando a célula é "Dia N"
  status text not null,                -- 'agendado' | 'concluido' | 'atrasado'
  valor_raw text not null,             -- célula crua do painel ("Dia 9", "Concluido", "Atrasado"...)
  capturado_em timestamptz not null
);
create index if not exists manutencoes_agenda_condo on manutencoes_agenda (id_condominio, ano, mes);
create unique index if not exists manutencoes_agenda_unica
  on manutencoes_agenda (id_condominio, categoria_id, ano, mes);

alter table manutencoes_agenda enable row level security;
revoke all on manutencoes_agenda from anon, authenticated;
