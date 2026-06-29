# Design — Motor de Escritas com Aprovação Humana (Ana → Superlógica)

- **Data:** 2026-06-29
- **Autor:** Nelson + Claude (brainstorming)
- **Status:** Design aprovado em brainstorming; aguardando revisão da spec
- **Decisão-gatilho:** Fernando (WhatsApp, 29/06/2026) autorizou as write-tools — *"Sim, pode implementar"* — com a regra firme: **toda alteração na base do Superlógica exige um "OK" humano antes de gravar.** "A Ana deixa tudo preenchido e conferido e a equipe só dá o 'ok' antes de gravar — nada sensível entra sem revisão humana."

---

## 1. Objetivo

Permitir que a Ana **escreva** no Superlógica (não só leia), sempre atrás de um **gate de aprovação humana universal**, e fazer isso por meio de um **motor genérico** ao qual novas operações de escrita plugam sem reescrever a infraestrutura — o caminho para cobrir 100% das escritas que a equipe faz hoje à mão.

### Escopo da v1
- **Construir o motor genérico** (registry de `WriteAction` + draft + painel de aprovação + gravação server-side + auditoria durável).
- **Implementar uma única ação real:** *cadastrar inquilino/residente* numa unidade (`PUT /unidades/post`).
- Subir 100% em modo **`DRY_RUN_WRITES=true`** (gravação mockada) até o gate-zero do token passar.

### Não-escopo da v1 (YAGNI)
- Demais ações do catálogo (§12) — só a espinha fica pronta para recebê-las.
- Reversão automática (a reversão é **assistida**, §8).
- Auto-aprovação / qualquer escrita sem OK humano.
- Migração da auditoria para banco (JSONL em volume basta na v1; interface permite trocar depois).

---

## 2. Princípios de design

1. **Gate humano universal.** Nenhuma escrita atinge o Superlógica sem um OK humano explícito. Sem exceção por "caso simples".
2. **Token de escrita nunca no alcance do LLM.** A tool dirigida por `$fromAI` só monta um *rascunho*. O `PUT/POST/DELETE` real roda **server-side**, no endpoint de aprovação, com a credencial de escrita — fora do alcance de prompt-injection.
3. **Uma máquina, N ações.** A espinha é agnóstica ao tipo de escrita. Adicionar uma função = escrever um objeto `WriteAction` (5–6 funções). Sem mudar o motor.
4. **Honestidade / anti-silent-failure.** Nunca "aprovado mas não gravado" em silêncio. Todo desfecho (gravado / erro / rejeitado / expirado) é registrado e comunicado.
5. **Auditoria durável e reversível.** Quem pediu, o que a Ana montou, quem aprovou, o payload enviado, a resposta, e o snapshot do estado anterior — em log durável (Redis não serve: TTL 48h).
6. **Sem over-engineering.** O contrato `WriteAction` fica mínimo. Justifica-se porque já há 7 usos reais previstos; mas só 1 é implementado na v1.

---

## 3. Arquitetura

### 3.1 O motor (escrito uma vez, compartilhado)

```
Morador (WhatsApp / Chatwoot)
   │  pedido de escrita
   ▼
Ana coleta dados + identifica solicitante/unidade  (camposColeta da ação)
   │  tool genérica: criar_rascunho_escrita(acao, dados)
   │     → valida, checa conflito/duplicidade, tira snapshot
   ▼
Redis  draft:<id>     +     Auditoria DURÁVEL [evento: criado]
   │
   ├──► Ana avisa o morador ("preenchi e mandei pra equipe conferir; confirmo ao aprovarem")
   │
   └──► ctx.draft → adapter Chatwoot posta NOTA INTERNA + link do painel + roteia p/ time
                          ▼
                   Equipe abre  GET /aprovacao/<token>   (protegido por passcode)
                   vê: campos preenchidos · snapshot atual · alerta de conflito · diff
                   ações:  [Aprovar]   [Corrigir e aprovar]   [Rejeitar]
                          │
                 Aprovar ▼  POST /aprovacao/<token>/aprovar   (server-side)
                   1. revalida (relê estado; re-checa conflito/staleness; aborta se mudou)
                   2. acao.gravar(payload)   → PUT real  (ou mock se DRY_RUN_WRITES=true)
                   3. Auditoria [evento: gravado]  (payload + resposta + snapshot + aprovador)
                   4. confirma de volta ao morador
```

### 3.2 Contrato `WriteAction`

Cada operação de escrita é um objeto registrado no `WRITE_ACTIONS`:

```
WriteAction = {
  id,                         // 'cadastro_inquilino'
  descricao,                  // alimenta a tool/$fromAI da Ana
  camposColeta,               // schema dos campos que a Ana coleta na conversa
  validar(dados)              -> { ok, erros[] }       // obrigatórios + regras de negócio
  checarConflito(ctx, dados)  -> { conflito, detalhe } // duplicidade / pré-condições
  snapshot(ctx, dados)        -> objeto               // estado "antes" (p/ reversão/auditoria)
  montarPayload(dados)        -> corpo Superlógica     // mapeia dados → campos da API
  gravar(payload)             -> { ok, id, resposta }  // ÚNICO ponto que escreve (server-side)
  timeAprovador,              // roteamento p/ time do Chatwoot
  render(dados, snapshot)     -> { campos[], diff[] }  // o que o painel mostra
}
```

O motor (draft, painel, auditoria, segurança, SLA, confirmação) **não conhece** os detalhes da ação — só chama essas funções.

---

## 4. Componentes (segue os padrões existentes do `agente-service`)

| Arquivo | Novo? | Responsabilidade |
|---|---|---|
| `src/write/registry.mjs` | novo | `WRITE_ACTIONS` (mapa id→WriteAction) + helpers de lookup |
| `src/write/engine.mjs` | novo | máquina genérica: criar draft, revalidar, executar `gravar`, auditar |
| `src/write/drafts.mjs` | novo | CRUD de `draft:<id>` no Redis (reusa `memory.mjs`); TTL/SLA |
| `src/write/auditoria.mjs` | novo | log append-only durável (JSONL em volume; interface trocável) |
| `src/write/actions/cadastro_inquilino.mjs` | novo | **ação #1** (contrato WriteAction concreto) |
| `src/superlogica.mjs` | editar | acrescentar leitura `responsaveis_index(unidade)` p/ snapshot/duplicidade |
| `src/superlogica_write.mjs` | novo | wrappers de escrita (`putUnidade`); respeita `DRY_RUN_WRITES`; usa credencial de escrita |
| `src/agent.mjs` | editar | registrar tool `criar_rascunho_escrita`; case em `runToolReal`; expor `ctx.draft` |
| `server.mjs` | editar | rotas `GET /aprovacao/<token>`, `POST /aprovacao/<token>/{aprovar,corrigir,rejeitar}` |
| `.tmp/chatwoot_adapter.mjs` (raiz NCS) | editar | handler `ctx.draft` → nota interna + label + roteamento (espelha `ctx.attachments`) |
| `test/test_write_engine.mjs` etc. | novo | testes determinísticos do motor + da ação #1 |

> ⚠️ **Acoplamento cross-repo:** o `chatwoot_adapter.mjs` vive em `.tmp/` na raiz do projeto NCS, **fora do repo git do `agente-service`**. É a única peça que cruza a fronteira de dois projetos → seu deploy é separado (stack/túnel próprios) e precisa entrar no plano de implementação junto com o do `agente-service`.

---

## 5. Ação #1 — Cadastrar inquilino/residente

### 5.1 Coleta (a Ana pergunta na conversa)
- Unidade + condomínio (já resolvidos pelo fluxo de identificação atual).
- Quem está pedindo (solicitante) — nome/unidade/CPF; **registrado, não bloqueado** (humano valida no OK).
- Do novo morador: **nome** (obrig.), papel (inquilino=residente / dependente), **data de entrada** (obrig.), e-mail, telefone, CPF.

### 5.2 Payload — `PUT /unidades/post`, array `contatos[0][...]`
Obrigatórios mapeados:
- `ST_NOME_CON` ← nome
- `DT_ENTRADA_RES` ← data de entrada (formato Superlógica **MM/DD/AAAA**)
- `ID_LABEL_TRES` ← **7** (residente/inquilino) ou **4** (dependente)
- `ID_TIPORESP_TRES` ← tipo de cobrança (default **4 = NÃO_RECEBER** para inquilino, salvo regra do condo) — *decisão a confirmar no §13*
- `ID_TIPOCONTATO_TRES`/`ID_TIPOCONTATO_TCON` ← 1 (condômino)

Opcionais: e-mail, telefone, CPF, `FL_ENTREGACOBRANCA_RESP`.

**Sem `ID_CONTATO_CON` → CRIA** (com `ID_CONTATO_CON` atualizaria). Logo o risco é **duplicação**.

### 5.3 Validações (`validar`)
- Campos obrigatórios presentes; data válida e não-passada-absurda; CPF bem-formado (se informado).
- `ID_LABEL_TRES` ∈ {7, 4}.

### 5.4 Conflito / duplicidade (`checarConflito`)
- `GET /responsaveis/index` da unidade → se já existe contato com **mesmo CPF** (ou mesmo nome normalizado) com papel ativo, sinaliza **conflito** (não bloqueia o draft, mas alerta no painel).
- ⚠️ `responsaveis/index` **ignora `idUnidade`** e devolve o condomínio inteiro → **sempre filtrar por `id_unidade_uni`** antes de comparar. PII: nunca logar cru.

### 5.5 Snapshot (`snapshot`)
- Lista de contatos atuais da unidade (do `responsaveis/index`, filtrado por `id_unidade_uni`) — guardada no draft e no log para reversão.

### 5.6 Gravação (`gravar`) — server-side
- `putUnidade(payload)` com a credencial de **escrita** (usuário de serviço). Se `DRY_RUN_WRITES` → mock (loga payload, retorna id fake), sem hit real.
- O **ID do contato criado não é documentado**: após gravar, reler `responsaveis/index` e localizar o novo contato (por CPF/nome+data) para registrar o id no log.
- **Match não único** (ex.: cadastro sem CPF e nome igual a um contato existente): **não adivinhar** — registrar **todos os candidatos** no log e sinalizar para conferência humana, evitando que a auditoria/reversão aponte o contato errado.

### 5.7 Roteamento
- `timeAprovador = 'Recepção'` (nó da Jussara). Configurável por ação.

---

## 6. Painel de aprovação

- **`GET /aprovacao/<token>`** — HTML leve (mesmo padrão/proteção do `/chat`): pede **passcode da equipe**; `<token>` forte por draft, com expiração (SLA).
- Mostra: dados preenchidos, **snapshot atual da unidade**, **alerta de conflito/duplicidade**, e (quando aplicável) **diff** antes/depois.
- Ações:
  - **`POST .../aprovar`** — revalida → grava → audita → confirma ao morador.
  - **`POST .../corrigir`** — equipe edita campos antes de aprovar (a edição é **auditada**: quem mudou o quê). **Corrigir reinicia o relógio do SLA** (§9) do draft.
  - **`POST .../rejeitar`** — registra motivo; avisa o morador / equipe assume.
- Idempotência: token só aprova **uma vez**; segunda chamada retorna o estado já gravado (não regrava).

---

## 7. Segurança & LGPD

- Credencial de escrita **só** no processo server-side do endpoint de aprovação; **nunca** passada à camada do LLM/tool.
- Necessário **usuário de serviço do Superlógica com permissão de escrita restrita** (pré-requisito Rodrigo). O token herda permissões do usuário criador.
- Painel atrás de passcode + token forte por draft + expiração; rota não-pública e não-adivinhável.
- Dados sensíveis (CPF, contatos de terceiros) nunca logados crus; auditoria guarda o necessário com cuidado de PII.
- Base legal/consentimento da coleta de dados de terceiros = responsabilidade do processo (humano valida quem pode pedir).

---

## 8. Auditoria durável & reversibilidade

- **Log append-only** (JSONL num volume persistente, fora do TTL do Redis; interface permite migrar p/ Supabase). Um registro por evento de ciclo de vida:
  - `criado` (solicitante, ação, dados, snapshot)
  - `corrigido` (quem, diff)
  - `gravado` (aprovador, payload enviado, resposta da API, id resultante)
  - `rejeitado` / `expirado` / `erro` (motivo)
- **Reversibilidade = assistida.** O Superlógica não expõe "undo". O snapshot do "antes" no log permite reverter manualmente (ex.: `DELETE /contatos/delete` do contato recém-criado, ou restaurar campos). Não há reversão automática na v1.

---

## 9. Tratamento dos pontos cegos

| Ponto cego | Tratamento |
|---|---|
| Token de escrita exposto ao $fromAI | PUT só no endpoint server-side; tool nunca vê o token |
| Permissão de escrita do token (não testada) | **Gate-zero** no rollout (§10) |
| Duplicação de contato | `checarConflito` no draft **e** revalidação ao aprovar |
| Staleness/concorrência (horas entre draft e OK) | revalida + relê estado no momento de gravar; aborta se mudou |
| Reversibilidade | snapshot do "antes" → reversão assistida |
| Auditoria | log durável append-only (Redis não serve) |
| Falha na gravação (500/rate-limit/validação) | retry limitado + estado `erro` + avisa equipe; nunca silencioso |
| Segurança do painel | passcode + token forte + expiração |
| SLA do draft | expira em **72h**; re-notifica equipe; morador avisado se demorar |
| Confirmação ao morador | dentro de 24h direto; fora da janela, registra p/ equipe (HSM futuro) |
| Edição humana | "Corrigir e aprovar" edita campos, auditado |
| ID do contato criado indocumentado | reler `responsaveis/index` pós-gravação e casar por CPF/nome+data |

---

## 10. Rollout seguro (resolve o token não-testado)

1. **Fase A — `DRY_RUN_WRITES=true`:** PUT mockado. A equipe homologa o gate inteiro (Ana → draft → painel → aprovar → confirma) **sem tocar a base real**.
2. **Em paralelo:** Rodrigo provê o **usuário de serviço com escrita**.
3. **Gate-zero (1 teste real controlado):** criar contato numa **unidade combinada com o Fernando** → conferir → `DELETE`. **Critério objetivo de "passou"** (anti-silent-failure): o `PUT` retorna HTTP 200 **e** o contato aparece no `responsaveis/index` da unidade **e** o `DELETE` confirma o sumiço. Só com os três o token está validado para escrita.
4. **Fase B — `DRY_RUN_WRITES=false`:** escrita real, sempre atrás do OK humano.

Deploy segue o loop padrão do projeto (push → Actions/GHCR → Portainer string-stack → smoke). Variáveis novas (ex.: credencial de escrita) **precisam entrar na lista fixa de env do `portainer_redeploy_string.mjs`**.

---

## 11. Testes

- **Determinísticos (sem LLM):** `validar`, `montarPayload` (formato MM/DD/AAAA, LABEL correto), `checarConflito` (filtro por `id_unidade_uni`), idempotência do token, transições de estado do draft, `DRY_RUN` não toca a API.
- **Engine genérico:** uma `WriteAction` fake exercita criar→aprovar→auditar sem Superlógica.
- **Auditoria:** todo desfecho gera registro; nenhum "aprovado sem gravar".
- **Stress LLM (tools mockadas):** a Ana coleta os campos certos e chama `criar_rascunho_escrita` sem alucinar dados; PII redigida; `ctx.chatId=null` = sem writes reais.

---

## 12. Catálogo até "fechar 100% das escritas" (roadmap)

Cada item pluga na mesma espinha (um arquivo `WriteAction`), com o mesmo OK humano.

| # | Ação | Endpoint | Observação |
|---|---|---|---|
| 1 | Cadastrar inquilino/residente | `PUT /unidades/post` (LABEL 7) | **v1** |
| 2 | Cadastrar dependente | `PUT /unidades/post` (LABEL 4) | quase grátis após #1 |
| 3 | Atualizar e-mail/telefone | `PUT /unidades/post` + `ID_CONTATO_CON` | baixo |
| 4 | Troca de titularidade | `PUT` (add LABEL 1/2) + `DELETE /contatos/delete` | médio; jurídico; `DT_SAIDA` indocumentado |
| 5 | Agendar mudança | `POST /reservas/` (área "Mudança") | médio |
| 6 | Reservar área comum | `POST /reservas/` | baixo (reusa #5) |
| 7 | Agendar cobrança/negociação +30d | `POST /historicocobranca/` | liga na cobrança extrajudicial |

(CND assinada já existe via Autentique.)

---

## 13. Decisões em aberto (pré-requisitos do cliente/Rodrigo)

1. **Usuário de serviço com escrita** no Superlógica — Rodrigo.
2. **Unidade de teste** para o gate-zero — Fernando.
3. **Regra de "quem pode pedir"** cadastro — provisório: Ana registra, humano valida. Confirmar com Fernando se quer regra mais rígida.
4. **`ID_TIPORESP_TRES` default** para inquilino (cobrança) — confirmar a regra contábil correta com o Fernando/financeiro.
5. **Qual time aprova** cada tipo — provisório: cadastro → Recepção.
6. **Onde a auditoria durável mora em produção** — JSONL em volume na v1; avaliar Supabase no regime.
