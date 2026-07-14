# Design — Onda 1: Notificação (outbox) + Aprovação no Portal (estrutura própria)

> Spec de implementação. Consolida: build da Onda 1 + feedback real do Fernando (11/07) + revisão do Fable 5. Norte: **estrutura própria, mínimo de telas, fundação do NCS Super.** Docs de origem: `proposta/revisao-fable-onda1-plano.md`, `comunicacao-fernando/feedback-fernando-onda1-11jul.md`, `proposta/interfaces-e-canal-de-aprovacao.md`.

## 1. Objetivo
Automatizar o cadastro (inquilino/dependente/proprietário/titularidade) da recepção com **aprovação humana no Portal próprio** e **aviso automático à portaria/síndico/garantidora**, de forma **auditável, sem falha silenciosa e reutilizável** (o mesmo motor serve mudança/cobrança/comunicado depois).

## 2. Princípios (do Fable)
1. **Um dado, uma fonte:** contatos/config por condomínio no Supabase (não em JSON no repo) — escala pro SaaS.
2. **Nada falha calado:** todo aviso que não sai sozinho vira **pendência VISÍVEL** numa fila.
3. **Um único executor de escrita:** o Portal é UI; o `agente-service` é quem grava (não duplicar lógica).
4. **Aprovação automática futura = aprovador sintético no MESMO pipeline** (nunca um atalho paralelo).
5. **Dispatch condicionado à GRAVAÇÃO**, nunca ao pedido (invariante).

## 3. Arquitetura
```
Morador → Ana (WhatsApp/Chatwoot) → criarRascunho → [escrita_drafts @ Supabase NCS]
                                                          │
Equipe → Portal (Estagiário, login/papel) → aba "Aprovações" (lê a fila)
   │ clica Aprovar (identidade do usuário)                │
   └── POST ncs-agente:8080/write/aprovar {draft_id, aprovador} ──┐
                                                                   ▼
        agente-service (ÚNICO executor): CAS status → gravar(Superlógica) → posGravar
                                                                   │
                                                    enfileira em [notificacoes @ Supabase]
                                                                   ▼
                        worker do outbox → resolve destinos (condominio_contatos) → canais:
                        zap_individual(síndico) [Cloud API oficial + template]
                        zap_grupo(portaria)     [ver §7 transporte]
                        email(portaria remota / garantidora) [mailer]
                        → status enviado|falhou|pendente_humano (fila visível no Portal)
```

## 4. Componentes

### 4.1 Conector de notificação — re-chavear por `tipo_portaria` + multi-destino
Substitui o `portaria_dispatch.mjs` mono-destino/por-sistema. Assinatura genérica (serve cadastro/mudança/etc.):
```
planejarAviso({ evento, condominio, ator }) → {
  ok, condominio,
  destinos: [ { papel:'portaria'|'sindico'|'garantidora', canal, endereco|null, status:'pronto'|'sem_contato', payload } ]
}
```
- **Canais:** `zap_grupo · zap_individual · email · web_form · nenhum`.
- **Precedência:** `override_condominio > regra_do_sistema > default_do_tipo_portaria`.
- **Defaults por `tipo_portaria`** (de `sistemas-portaria.json`, que já tem o campo):
  | tipo_portaria | destinos |
  |---|---|
  | Humana | `zap_grupo(portaria)` + `zap_individual(síndico)` |
  | Virtual/remota | `email(portaria)` + `zap_individual(síndico)` |
  | Híbrida | **[DEFINIR c/ Fernando]** |
  - GatWay → `nenhum` (**confirmar se síndico recebe**); Synnus → `zap_individual(zeladora)`.
- **"Pessoa" (Tiago/zeladora/síndica) NÃO é canal** — é `zap_individual`/`email` sem contato → `status:'sem_contato'` → pendência.
- Garantidora entra como mais um `papel:'garantidora'` no MESMO shape (unifica `garantidora_dispatch`).

### 4.2 `condominio_contatos` (Supabase) — o dado que falta
Tabela no Supabase dedicado (`dcirzddyoctxugfowvob`). **Um dado, 3 consumidores** (aviso, CND assinada, mudança Onda 3):
```
condominio_contatos(condominio_id, sindico_nome, sindico_whatsapp, portaria_grupo_jid,
  portaria_email, pessoa_nome, pessoa_whatsapp, pessoa_email, atualizado_em)
```
- **Piloto:** pode ser um JSON sincronizado da tabela; **a interface do módulo é agnóstica à fonte** ("dou o condo, recebo os destinos").
- UI de manutenção no Portal = depois.

### 4.3 Outbox de notificações (o sub-sistema genérico do NCS Super)
```
notificacoes(id, evento, condominio_id, papel, canal, endereco, payload jsonb,
  status:'pendente'|'enviado'|'falhou'|'pendente_humano', tentativas, ultimo_erro, criado_em, enviado_em)
```
- **Worker** com retry (padrão do `cronSweep` do adapter). Falha/sem-contato → `pendente_humano`.
- **Aba "Avisos/Pendências" no Portal** — mata as 2 falhas silenciosas atuais (JSONL que ninguém abre + `console.warn`).
- **Produtores:** cadastro, titularidade (garantidora), e depois mudança/cobrança/comunicado.

### 4.4 Aprovação no Portal (migra do Redis → Supabase; conserta 3 bugs)
```
escrita_drafts(id, acao, dados jsonb, snapshot jsonb, conflito jsonb, status, time,
  solicitante, origem jsonb, aprovado_por jsonb, criado_em, expira_em, resultado jsonb)
escrita_eventos(id, draft_id, tipo, ator, payload jsonb, criado_em)   -- append-only, deny-all
```
- **Concorrência (fix bug):** aprovar = `UPDATE escrita_drafts SET status='aprovando', aprovado_por=$1 WHERE id=$2 AND status='pendente' RETURNING *` (compare-and-swap). Sem isso, 2 aprovadores = gravação dupla.
- **Expiração NÃO deleta:** sweep marca `expirado` + `notificarMorador` (já existe). Purga LGPD depois (padrão do Estagiário).
- **Auditoria durável:** `registrarEvento` → `escrita_eventos` (peso legal, hoje fora do backup).
- **`pode_aprovar` (boolean) em `usuarios`** — admin liga por usuário no painel gestão. Sessão carrega o campo (revogável via `sessao_versao`). Grava `aprovado_por{user_id,nome,papel}`. **Sem RBAC** (YAGNI).
- **Executor único:** Portal chama `POST ncs-agente:8080/write/aprovar` (rede interna do VPS, mesmo padrão do adapter). O `agente-service` valida/grava/posGravar/enfileira o outbox.
- **Onda 1 = todos passam por humano** (Fernando). **Auto-aprovação futura** = `criarRascunho` consulta política (`porAcao + sem conflito + validação ok`) → chama o **mesmo** `aprovarRascunho` com `aprovador:'sistema:politica-v1'`.

### 4.5 Templates de texto fora do código
`data/templates/<evento>-<papel>.md` com placeholders `{{nome}}`/`{{unidade}}` (`replace`, sem engine). Motivo: Fernando disse que o texto "pode mudar conforme regimento/convenção" → hoje é string hardcoded (commit+build+deploy por ajuste). **Pré-req:** recuperar os termos-exemplo do Superlógica que ele anexou.

## 5. Transporte WhatsApp (§7 do Fable — decisão a tomar)
- **Síndico (`zap_individual`):** **Cloud API oficial** (número real da Ana) + **template utility "novo cadastro"** aprovado pela Meta (aviso fora da janela 24h exige template).
- **Grupo da portaria (`zap_grupo`):** Cloud API **não envia a grupo**. Decisão: **(a) Zuck com número DEDICADO só-avisos** (risco de ban isolado, fallback e-mail/pendência) **ou (b) zap individual do porteiro-chefe** (oficial). + **onboarding de campo:** o número emissor precisa ser MEMBRO de cada grupo (~30) — dono+prazo.
- **Remota / garantidora:** `email` (mailer já pronto).

## 6. Bloqueadores ANTES de sair do DRY_RUN (escrita real)
1. **`ID_TIPORESP_TRES` / regra contábil** (`cadastro_inquilino.mjs`) — define quem recebe cobrança. Confirmar c/ Rodrigo/Fernando. Idem nomes de campo `MAP_OPCIONAIS`.
2. **LGPD — dataset mínimo por destinatário:** o CPF completo precisa ir pra portaria/garantidora? (facial é no condo). Mascarar onde der; registrar base legal.

## 7. Escala / NCS Super
- Config por condo → **tabelas Supabase** (`condominios`, `condominio_contatos`, `condominio_config`); módulos agnósticos à fonte.
- **Notificador (outbox) = sub-sistema genérico** reusado por mudança/cobrança/comunicado.
- **Multi-tenant:** `condominio_id` já é chave natural; `conta_id` depois é barato **se nada hardcodar "NCS"** (templates resolvem a assinatura no corpo).
- `zap_grupo` = conveniência (1 ban → N clientes no SaaS); espinha = template oficial + e-mail + portal futuro.
- **Honestidade:** roteamento *entre agentes* ainda não existe (handoff é pra times humanos); não vender como pronto. Não prometer desligar o Octadesk antes do ticket-por-e-mail.

## 8. Escopo AGORA × depois
- **Agora:** conector por tipo_portaria + `condominio_contatos` (JSON/tabela) + outbox + fila no Portal + aprovação no Supabase (CAS/eventos/pode_aprovar) + templates + transporte decidido.
- **Depois (YAGNI):** integração Shielder (confirmar segunda se já sincroniza), RPA TW Virtua, RBAC granular, inbox próprio absorvendo o Chatwoot, UI de manutenção de contatos.

## 9. Testes
- Conector: por tipo_portaria (Humana→zap_grupo+síndico; Remota→email+síndico; GatWay→nenhum; sem_contato→pendência), precedência override, multi-destino.
- Outbox: enfileira, retry, falha→pendente_humano, fila lista.
- Aprovação: CAS (2 aprovações concorrentes → 1 grava), expiração marca+notifica, aprovador registrado, executor único.
- Regressão: manter as 4 suítes do motor verdes + as dos conectores.

## 10. Sequência de implementação
1. Conector re-chaveado por `tipo_portaria` + multi-destino (+ testes) — o dado já existe.
2. `condominio_contatos` (tabela + módulo de resolução agnóstico à fonte).
3. Outbox `notificacoes` + worker + aba "Pendências" no Portal.
4. Migração `escrita_drafts`/`escrita_eventos` → Supabase (CAS, expiração-marca, auditoria durável).
5. `pode_aprovar` + aba "Aprovações" no Portal + rota executor no agente-service.
6. Templates de texto.
7. (fora do DRY_RUN só após os bloqueadores §6.)
