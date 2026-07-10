-- Estagiário (Chat NCS) — login por usuário + analytics de uso
-- Projeto Supabase dedicado do NCS (dcirzddyoctxugfowvob). Acesso 100% server-side com service_role.
-- Ver spec: proposta/estagiario-login-analytics-spec.md §4.4

create table if not exists usuarios (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  nome text not null,
  papel text not null default 'funcionario',   -- 'admin' | 'funcionario'
  senha_hash text,                              -- null enquanto não ativou
  senha_salt text,
  ativo boolean not null default true,
  sessao_versao int not null default 1,         -- reset/reativação incrementa → invalida cookies antigos
  convite_token_hash text,                      -- só o hash; null após ativar
  convite_expira timestamptz,
  ultimo_acesso timestamptz,
  criado_em timestamptz not null default now()
);

create table if not exists interacoes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references usuarios(id),
  session_id text,            -- a "conversa/demanda" (estag-<uid>-<convId>)
  condominio text,            -- slug/nome extraído do argumento da tool (pode ser null)
  tag text,                   -- taxonomia fixa; null → painel trata como 'outro'
  pergunta text,              -- o que foi pedido (oculto por padrão no painel — LGPD/demo)
  resposta text,              -- resposta truncada ~500 chars (auditoria "o que a IA disse")
  gerou_doc boolean default false,
  tipo_doc text,              -- multa | notificacao | cnd | relatorio | null
  modelo text,                -- ex.: gpt-5.4
  tokens_prompt int, tokens_completion int, tokens_cached int,
  latencia_ms int, erro boolean default false,
  criado_em timestamptz not null default now()
);
create index if not exists interacoes_usuario_data on interacoes (usuario_id, criado_em);
create index if not exists interacoes_data on interacoes (criado_em);

-- Retenção (LGPD, S3): o serviço purga automaticamente as linhas de `interacoes` com
-- criado_em anterior a RETENCAO_DIAS (env, default 180) — sweep ~30s após o boot e a cada 24h
-- (server.mjs → purgarInteracoesAntigas, DELETE via PostgREST). CPF é mascarado (***) em
-- pergunta/resposta ANTES da gravação (registro.mjs → mascararCpf). O índice interacoes_data
-- (criado_em) sustenta o filtro `criado_em < corte` da purga.

-- Hardening: deny-all. service_role bypassa RLS; ninguém mais lê/escreve.
alter table usuarios enable row level security;
alter table interacoes enable row level security;
revoke all on usuarios, interacoes from anon, authenticated;
