-- solicitacoes_f1.sql — F1 da saída do Octadesk: a Ana carimba o ticket DIRETO na fila.
-- A tabela `solicitacoes` nasceu ad-hoc (worker-espelho, F0). Esta migração a prepara para receber
-- linhas de origem PRÓPRIA (a Ana), sem quebrar o espelho (que sempre preenche protocolo_ncs).
-- Idempotente (add column if not exists / drop not null). Aplicada no Supabase dcirzddyoctxugfowvob.
--
-- Por que cada coluna:
--   origem       — de onde veio o ticket: 'octadesk' (espelho), 'ana' (carimbo direto), 'formulario' (F3).
--                  Default 'octadesk' → linhas existentes ficam corretas sem UPDATE.
--   canal        — 'whatsapp' | 'form'. Contexto de entrada.
--   draft_id     — vínculo com escrita_drafts (a linha de escrita-ERP nasce ligada ao rascunho; base da F2).
--   resolvido_*  — quem/quando resolveu (o botão "Resolver" da F2 grava aqui).
--   numero       — sequência humana p/ o protocolo próprio NCS-A-<numero>. Linhas antigas ficam NULL
--                  (usam o protocolo do Octa); só novas linhas puxam da sequência.
-- E protocolo_ncs deixa de ser NOT NULL: a Ana insere e, no 2º passo, grava NCS-A-<numero> (o numero
-- só existe depois do insert). Nulos são permitidos no índice único do Postgres — sem conflito.

alter table solicitacoes add column if not exists origem text not null default 'octadesk';
alter table solicitacoes add column if not exists canal text;
alter table solicitacoes add column if not exists draft_id text;
alter table solicitacoes add column if not exists resolvido_por text;
alter table solicitacoes add column if not exists resolvido_em timestamptz;

alter table solicitacoes add column if not exists numero bigint;
create sequence if not exists solicitacoes_numero_seq;
alter table solicitacoes alter column numero set default nextval('solicitacoes_numero_seq');

alter table solicitacoes alter column protocolo_ncs drop not null;
