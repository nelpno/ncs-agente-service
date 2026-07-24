-- Índice global de pessoas (espelho dos responsáveis dos condomínios) — base do NCS Super.
-- Aplicado no Supabase do NCS (dcirzddyoctxugfowvob) via migração `create_pessoas_index_cpf` (24/07/2026).
-- Alimentado pela API PÚBLICA v2 (responsaveis/index) por scripts/sync_pessoas.mjs (rodar periódico).
-- Consumido pela Ana em src/pessoas.mjs → busca O(1) por CPF (mata a varredura de 59 condos).
-- Backend-only (service_role), deny-all. LGPD: só o mínimo p/ identificar morador — NUNCA cartão/banco/RG/nascimento.
create table if not exists pessoas (
  id uuid primary key default gen_random_uuid(),
  id_condominio int not null,
  condominio text,
  id_contato int,
  id_unidade int,
  unidade text,
  bloco text,
  nome text,
  doc text,               -- CPF ou CNPJ, só dígitos (null se não cadastrado)
  doc_tipo text,          -- 'cpf' | 'cnpj' | null
  papel text,             -- st_nometiporesp_tres (Proprietário/Inquilino/...)
  id_label int,           -- id_label_tres
  email text,
  telefone text,
  entrega_cobranca text,  -- fl_entregacobranca_resp
  ativo boolean,          -- dt_saida vazio = ativo
  dt_entrada text,
  dt_saida text,
  capturado_em timestamptz not null default now()
);
create index if not exists pessoas_doc on pessoas (doc);
create index if not exists pessoas_nome on pessoas (lower(nome));
create index if not exists pessoas_condo on pessoas (id_condominio);
create index if not exists pessoas_unidade on pessoas (id_condominio, id_unidade);

alter table pessoas enable row level security;
revoke all on pessoas from anon, authenticated;
