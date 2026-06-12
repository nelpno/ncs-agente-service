# Agente NCS — serviço (Ana)

Serviço web do agente de IA da NCS: recebe a conversa do **Octadesk** (componente "Conecte a outro sistema"), pensa com **Gemini 2.5 Flash** (via OpenRouter), **lê o Superlógica de verdade** (boleto/PIX/cadastro) e responde / marca tag / encaminha pra humano.

> Piloto = **somente leitura** no Superlógica (`DRY_RUN_WRITES=true`). Modelo, tokens e segredos vêm de variáveis de ambiente (no Portainer) — **nada no código/imagem**.

## Arquitetura
```
WhatsApp → Octadesk (fluxo: "Conecte a outro sistema") → [este serviço /webhook]
   → Gemini 2.5 Flash (OpenRouter)  → tools de leitura Superlógica (PIX/boleto/cadastro)
   → responde no chat / marca tag / encaminha pra humano (componente de transferência do fluxo)
```

## Arquivos
- `server.mjs` — webhook + health. `src/agent.mjs` — loop do agente. `src/superlogica.mjs` — leituras reais. `src/octadesk.mjs` — ações. `src/llm.mjs` — OpenRouter. `spec/system-prompt.md` — o cérebro.
- `Dockerfile` + `docker-compose.yml` (serviço + cloudflared).

## Deploy no Portainer (passo a passo)
1. **Cloudflare Tunnel:** no painel Cloudflare → Zero Trust → Tunnels → criar túnel → **public hostname** `agente.seudominio.com` → serviço `http://ncs-agente:8080`. Copie o **token do túnel**.
2. **Portainer:** Stacks → **Add stack** → cole o `docker-compose.yml` (ou aponte pro repositório Git).
3. **Variáveis de ambiente** (na própria stack): `OPENROUTER_API_KEY`, `OCTADESK_API_KEY`, `SUPERLOGICA_APP_TOKEN`, `SUPERLOGICA_ACCESS_TOKEN`, `WEBHOOK_SECRET` (invente um), `CLOUDFLARE_TUNNEL_TOKEN`, `OCTADESK_AGENT_EMAIL`.
4. **Deploy.** Teste: `https://agente.seudominio.com/health` deve responder `{ "ok": true }`.

## Ligar no Octadesk
5. No **fluxo (bot)**, no ponto onde quer a IA, adicione **"Conecte a outro sistema"** apontando para `https://agente.seudominio.com/webhook`, com header `x-webhook-secret: <WEBHOOK_SECRET>`.
6. Adicione o **componente de transferência** logo depois, acionado pela tag `ia-transferir-*` (a IA marca essa tag quando encaminha) — montar **1×**.
7. Teste com **1 conversa real** de 2ª via. Os logs do container mostram a estrutura do payload (sem PII) — ajustamos o `parsePayload` se algum campo vier com outro nome.

## Antes de produção (não no piloto)
- Regenerar tokens do Superlógica num **usuário de serviço só-leitura**.
- Trocar a memória RAM por **Redis** (queue-safe) se o Octadesk rodar em fila/múltiplas instâncias.
- DPA + log de auditoria + residência BR. Migrar o container pro **servidor da NCS** (mesma imagem).
