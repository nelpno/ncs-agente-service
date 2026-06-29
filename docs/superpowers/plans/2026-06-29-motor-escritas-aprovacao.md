# Motor de Escritas com Aprovação Humana — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar à Ana a capacidade de **escrever no Superlógica** (1ª ação: cadastro de inquilino) sempre atrás de um **gate de aprovação humana**, sobre um **motor genérico** ao qual novas ações plugam sem reescrever a infraestrutura.

**Architecture:** Tool específica da Ana monta um *rascunho* (sem token de escrita) → motor genérico persiste o draft no Redis + registra auditoria durável + sinaliza `ctx.draft` → adapter Chatwoot posta nota interna com link → painel `/aprovacao/<token>` (server-side) deixa a equipe Aprovar/Corrigir/Rejeitar → ao aprovar, o motor revalida, chama `acao.gravar()` (real ou mock por `DRY_RUN_WRITES`), audita e notifica o morador. Toda a v1 roda em `DRY_RUN_WRITES=true` — não depende da credencial de escrita.

**Tech Stack:** Node ESM (`.mjs`), `http` nativo, Redis (com fallback Map), `fetch` + `AbortSignal.timeout`, testes determinísticos `node test/*.mjs` (`ok(cond,msg)` + `process.exit`).

**Spec:** `docs/superpowers/specs/2026-06-29-motor-escritas-aprovacao-design.md`

**Refinamento sobre a spec (decisão de implementação):** a Ana expõe **uma tool específica por ação** (`criar_rascunho_cadastro`), não a tool genérica `criar_rascunho_escrita(acao,dados)`. Motivo: schema próprio por ação reduz alucinação de campos (skill `llm-context-isolation`). O **motor (registry/engine/drafts/auditoria) permanece genérico**: cada nova ação = 1 arquivo de `WriteAction` + 1 tool fina que chama `engine.criarRascunho(<id>, …)`.

**Convenção de cwd:** todos os comandos rodam de dentro de `automacoes/agente-service/` (o repo git). Os `.mjs` de deploy/teste cross-repo vivem em `<raiz NCS>/.tmp/`.

**Princípio de testabilidade:** funções de IO das ações recebem um objeto `io` opcional (injeção de dependência) com defaults reais — testes passam `io` fake e rodam sem rede. Ex.: `checarConflito(ctx, dados, io = { responsaveisIndex })`.

---

## Chunk 1: Fundações (config + KV helpers)

### Task 1: Variáveis de config novas

**Files:**
- Modify: `src/config.mjs` (objeto `config`, ~linhas 446-476)

- [ ] **Step 1: Escrever o teste**

Create `test/test_config_write.mjs`:
```javascript
// test_config_write.mjs — config do motor de escritas tem defaults seguros
import { config } from '../src/config.mjs';
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

ok(config.dryRunWrites === true, 'dryRunWrites default true (seguro)');
ok(typeof config.auditLogPath === 'string' && config.auditLogPath.length > 0, 'auditLogPath definido');
ok(typeof config.approvalPasscode === 'string', 'approvalPasscode existe (pode herdar chatPasscode)');
ok('slWriteApp' in config && 'slWriteAccess' in config, 'credencial de escrita separada (vazia em DRY_RUN)');
ok('adapterNotifyUrl' in config, 'adapterNotifyUrl existe (vazio = sem push)');

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `node test/test_config_write.mjs`
Expected: FALHA (auditLogPath/approvalPasscode/slWriteApp/adapterNotifyUrl indefinidos)

- [ ] **Step 3: Implementar (no objeto `config` em `src/config.mjs`)**

Adicionar estas chaves ao objeto `config` (não remover as existentes; `dryRunWrites` já existe):
```javascript
  // --- Motor de escritas ---
  auditLogPath: env.AUDIT_LOG_PATH || './.data/audit/escritas.jsonl',
  approvalPasscode: env.APPROVAL_PASSCODE || env.CHAT_PASSCODE || '',
  approvalTtlH: parseInt(env.APPROVAL_TTL_H || '72', 10),
  slWriteApp: env.SUPERLOGICA_WRITE_APP_TOKEN || '',     // vazio em DRY_RUN; usuário de serviço c/ escrita depois
  slWriteAccess: env.SUPERLOGICA_WRITE_ACCESS_TOKEN || '',
  adapterNotifyUrl: env.ADAPTER_NOTIFY_URL || '',         // ex.: https://chatwoot-bot.dynamicagents.tech/notify/<secret>
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `node test/test_config_write.mjs`
Expected: TODOS OS TESTES VERDES

- [ ] **Step 5: Commit**

```bash
git add src/config.mjs test/test_config_write.mjs
git commit -m "feat(write): config do motor de escritas (DRY_RUN-safe defaults)"
```

---

### Task 2: KV helpers genéricos em memory.mjs

Reusa o mesmo client Redis (não abre conexão nova) e o mesmo fallback Map de sessões. Usado pelos drafts.

**Files:**
- Modify: `src/memory.mjs` (adicionar exports ao fim; reusar `useRedis()`/`redis`)
- Test: `test/test_kv.mjs`

- [ ] **Step 1: Escrever o teste**

Create `test/test_kv.mjs`:
```javascript
// test_kv.mjs — KV genérico (fallback Map quando sem Redis)
import { kvSet, kvGet, kvDel } from '../src/memory.mjs';
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

await kvSet('kvt:1', { a: 1 }, 60);
const v = await kvGet('kvt:1');
ok(v && v.a === 1, 'kvSet/kvGet round-trip');
await kvDel('kvt:1');
ok((await kvGet('kvt:1')) === null, 'kvDel remove');
ok((await kvGet('kvt:inexistente')) === null, 'miss retorna null');

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test/test_kv.mjs`
Expected: FALHA (kvSet/kvGet/kvDel não exportados)

- [ ] **Step 3: Implementar (fim de `src/memory.mjs`)**

```javascript
// --- KV genérico (reusa o mesmo client/fallback das sessões) ---
const kvFallback = new Map(); // key -> { value, expires }
export async function kvSet(key, value, ttlS) {
  if (useRedis()) {
    try { await redis.set(key, JSON.stringify(value), 'EX', ttlS); return; }
    catch (err) { console.warn('[memory] kvSet Redis erro:', err.message, '— fallback Map'); }
  }
  kvFallback.set(key, { value, expires: Date.now() + ttlS * 1000 });
}
export async function kvGet(key) {
  if (useRedis()) {
    try { const raw = await redis.get(key); return raw ? JSON.parse(raw) : null; }
    catch (err) { console.warn('[memory] kvGet Redis erro:', err.message, '— fallback Map'); }
  }
  const v = kvFallback.get(key);
  if (!v || v.expires < Date.now()) { kvFallback.delete(key); return null; }
  return v.value;
}
export async function kvDel(key) {
  if (useRedis()) {
    try { await redis.del(key); return; }
    catch (err) { console.warn('[memory] kvDel Redis erro:', err.message); }
  }
  kvFallback.delete(key);
}
```
> Confirme que `useRedis` e `redis` estão acessíveis nesse escopo do módulo (estão — são usados por `getSession`). Se forem `const` locais, os helpers ficam no mesmo arquivo, então OK.

- [ ] **Step 4: Rodar e ver passar**

Run: `node test/test_kv.mjs`
Expected: TODOS OS TESTES VERDES

- [ ] **Step 5: Commit**

```bash
git add src/memory.mjs test/test_kv.mjs
git commit -m "feat(write): kvGet/kvSet/kvDel reusando client Redis das sessões"
```

---

## Chunk 2: Persistência (auditoria durável + drafts)

### Task 3: Auditoria durável (JSONL append-only)

**Files:**
- Create: `src/write/auditoria.mjs`
- Test: `test/test_auditoria.mjs`

- [ ] **Step 1: Escrever o teste**

Create `test/test_auditoria.mjs`:
```javascript
// test_auditoria.mjs — log append-only durável
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = path.join(os.tmpdir(), `audit_${Date.now()}.jsonl`);
process.env.AUDIT_LOG_PATH = tmp; // antes do import (config lê no import)
const { registrarEvento, lerEventos } = await import('../src/write/auditoria.mjs');
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

await registrarEvento({ tipo: 'criado', draftId: 'd1', acao: 'cadastro_inquilino' });
await registrarEvento({ tipo: 'gravado', draftId: 'd1', aprovador: 'maria' });
const evs = await lerEventos({ draftId: 'd1' });
ok(evs.length === 2, 'dois eventos persistidos (append, não sobrescreve)');
ok(evs[0].tipo === 'criado' && evs[1].tipo === 'gravado', 'ordem preservada');
ok(typeof evs[0].ts === 'string' && evs[0].ts.length > 0, 'timestamp carimbado');
try { fs.unlinkSync(tmp); } catch {}
console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test/test_auditoria.mjs`
Expected: FALHA (módulo não existe)

- [ ] **Step 3: Implementar**

Create `src/write/auditoria.mjs`:
```javascript
// auditoria.mjs — log append-only durável de escritas (NÃO é log de aplicação; contém PII).
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.mjs';

function ensureDir() {
  const dir = path.dirname(config.auditLogPath);
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
}

export async function registrarEvento(ev) {
  ensureDir();
  const linha = JSON.stringify({ ts: new Date().toISOString(), ...ev }) + '\n';
  await fs.promises.appendFile(config.auditLogPath, linha, 'utf8');
}

export async function lerEventos(filtro = {}) {
  let raw;
  try { raw = await fs.promises.readFile(config.auditLogPath, 'utf8'); }
  catch { return []; }
  const evs = raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return evs.filter((e) => Object.entries(filtro).every(([k, v]) => e[k] === v));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node test/test_auditoria.mjs`
Expected: TODOS OS TESTES VERDES

- [ ] **Step 5: Commit**

```bash
git add src/write/auditoria.mjs test/test_auditoria.mjs
git commit -m "feat(write): auditoria durável append-only (JSONL)"
```

---

### Task 4: Drafts (CRUD no Redis + ciclo de vida + SLA)

**Files:**
- Create: `src/write/drafts.mjs`
- Test: `test/test_drafts.mjs`

- [ ] **Step 1: Escrever o teste**

Create `test/test_drafts.mjs`:
```javascript
// test_drafts.mjs — ciclo de vida do draft (sem Redis = fallback Map)
import { criarDraft, getDraftByToken, getDraft, updateDraft } from '../src/write/drafts.mjs';
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

const d = await criarDraft({ acao: 'cadastro_inquilino', dados: { nome: 'X' }, snapshot: [], solicitante: null, time: 'Recepção' });
ok(d.id && d.token && d.token.length >= 16, 'gera id + token forte');
ok(d.status === 'pendente', 'nasce pendente');
ok(d.expiraEm > Date.now(), 'tem expiração futura (SLA)');

const byTok = await getDraftByToken(d.token);
ok(byTok && byTok.id === d.id, 'recupera por token');

await updateDraft(d.id, { status: 'gravado' });
ok((await getDraft(d.id)).status === 'gravado', 'updateDraft persiste patch');

ok((await getDraftByToken('token-inexistente')) === null, 'token inválido retorna null');
console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test/test_drafts.mjs`
Expected: FALHA (módulo não existe)

- [ ] **Step 3: Implementar**

Create `src/write/drafts.mjs`:
```javascript
// drafts.mjs — rascunhos de escrita pendentes de aprovação. Persistência via KV (Redis+fallback).
import crypto from 'node:crypto';
import { kvGet, kvSet, kvDel } from '../memory.mjs';
import { config } from '../config.mjs';

const PREFIX_ID = 'draft:id:';
const PREFIX_TOK = 'draft:tok:'; // token -> id (índice)
const ttlS = () => config.approvalTtlH * 3600;

export async function criarDraft({ acao, dados, snapshot, solicitante, time, conflito = null, origem = null }) {
  const id = crypto.randomBytes(8).toString('hex');
  const token = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  const draft = {
    id, token, acao, dados, snapshot, solicitante, time, conflito, origem,
    status: 'pendente', criadoEm: now, expiraEm: now + ttlS() * 1000,
  };
  await kvSet(PREFIX_ID + id, draft, ttlS());
  await kvSet(PREFIX_TOK + token, id, ttlS());
  return draft;
}

export async function getDraft(id) { return kvGet(PREFIX_ID + id); }

export async function getDraftByToken(token) {
  const id = await kvGet(PREFIX_TOK + token);
  if (!id) return null;
  return getDraft(id);
}

export async function updateDraft(id, patch) {
  const cur = await getDraft(id);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  // restante de TTL aproximado pelo expiraEm; se patch reinicia SLA, atualiza expiraEm e índice
  const restanteS = Math.max(60, Math.ceil((next.expiraEm - Date.now()) / 1000));
  await kvSet(PREFIX_ID + id, next, restanteS);
  await kvSet(PREFIX_TOK + next.token, id, restanteS);
  return next;
}
```
> Nota: a expiração física é o TTL do KV; `expiraEm` permite a UI/engine detectarem expiração lógica e o "Corrigir" reinicia o SLA via `updateDraft(id, { expiraEm: Date.now()+ttlMs })`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node test/test_drafts.mjs`
Expected: TODOS OS TESTES VERDES

- [ ] **Step 5: Commit**

```bash
git add src/write/drafts.mjs test/test_drafts.mjs
git commit -m "feat(write): drafts (CRUD + token + SLA) via KV"
```

---

## Chunk 3: Superlógica (leitura p/ snapshot + escrita DRY_RUN)

### Task 5: Leitura `responsaveisIndex` (snapshot/duplicidade)

**Files:**
- Modify: `src/superlogica.mjs` (adicionar função + export, padrão do `slGet`)
- Test: `test/test_responsaveis.mjs`

- [ ] **Step 1: Escrever o teste** (testa o FILTRO por unidade, que é puro)

Create `test/test_responsaveis.mjs`:
```javascript
// test_responsaveis.mjs — filtro por unidade (responsaveis/index ignora idUnidade)
import { filtrarPorUnidade } from '../src/superlogica.mjs';
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

const dados = [
  { id_unidade_uni: '100', st_nome_con: 'A' },
  { id_unidade_uni: '200', st_nome_con: 'B' },
  { id_unidade_uni: '100', st_nome_con: 'C' },
];
const r = filtrarPorUnidade(dados, '100');
ok(r.length === 2 && r.every((x) => x.id_unidade_uni === '100'), 'filtra só a unidade pedida');
ok(filtrarPorUnidade(dados, '999').length === 0, 'unidade inexistente = vazio');
console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test/test_responsaveis.mjs`
Expected: FALHA (`filtrarPorUnidade` não existe)

- [ ] **Step 3: Implementar (em `src/superlogica.mjs`, ao lado de `slGet`)**

```javascript
// responsaveis/index IGNORA idUnidade e devolve o condomínio inteiro → sempre filtrar.
export function filtrarPorUnidade(lista, idUnidade) {
  const alvo = String(idUnidade);
  return (Array.isArray(lista) ? lista : []).filter((x) => String(x.id_unidade_uni) === alvo);
}

export async function responsaveisIndex(idCondominio, idUnidade) {
  const data = await slGet('responsaveis/index', { idCondominio });
  const lista = Array.isArray(data) ? data : (data?.data || data?.registros || []);
  return idUnidade != null ? filtrarPorUnidade(lista, idUnidade) : lista;
}
```
> Confira a forma de retorno real de `responsaveis/index` em `descoberta/superlogica-api-live-map.md` e ajuste o desempacotamento (`data?.data` etc.) se necessário. Nunca logar a lista crua (PII).

- [ ] **Step 4: Rodar e ver passar**

Run: `node test/test_responsaveis.mjs`
Expected: TODOS OS TESTES VERDES

- [ ] **Step 5: Commit**

```bash
git add src/superlogica.mjs test/test_responsaveis.mjs
git commit -m "feat(write): responsaveisIndex + filtrarPorUnidade (snapshot/duplicidade)"
```

---

### Task 6: Escrita `slPut` (respeita DRY_RUN_WRITES)

**Files:**
- Create: `src/superlogica_write.mjs`
- Test: `test/test_slput.mjs`

- [ ] **Step 1: Escrever o teste** (DRY_RUN não toca a rede)

Create `test/test_slput.mjs`:
```javascript
// test_slput.mjs — em DRY_RUN, slPut NÃO faz fetch e ecoa o payload
process.env.DRY_RUN_WRITES = 'true'; // antes do import
const { slPut } = await import('../src/superlogica_write.mjs');
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

const r = await slPut('unidades/post', { 'contatos[0][ST_NOME_CON]': 'Fulano' });
ok(r.ok === true && r.dryRun === true, 'DRY_RUN retorna ok+dryRun sem rede');
ok(r.echo && r.echo['contatos[0][ST_NOME_CON]'] === 'Fulano', 'ecoa o payload p/ inspeção');
console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test/test_slput.mjs`
Expected: FALHA (módulo não existe)

- [ ] **Step 3: Implementar**

Create `src/superlogica_write.mjs`:
```javascript
// superlogica_write.mjs — escrita no Superlógica. PUT só roda server-side, fora do alcance do $fromAI.
import { config } from './config.mjs';

const SL_TIMEOUT_MS = Number(process.env.SL_TIMEOUT_MS || 20000);

// credencial de ESCRITA (usuário de serviço); cai na de leitura só se não houver (irrelevante em DRY_RUN)
function writeAuth() {
  return {
    app_token: config.slWriteApp || config.slApp,
    access_token: config.slWriteAccess || config.slAccess,
  };
}

export async function slPut(controllerAction, fields, method = 'PUT') {
  if (config.dryRunWrites) {
    console.log(`[slPut] DRY_RUN ${method} ${controllerAction} (${Object.keys(fields).length} campos)`);
    return { ok: true, dryRun: true, echo: fields };
  }
  const url = `${config.slBase}/${controllerAction}`;
  const body = new URLSearchParams(fields).toString();
  const r = await fetch(url, {
    method,
    headers: { ...writeAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(SL_TIMEOUT_MS),
  });
  const texto = await r.text();
  let resposta; try { resposta = JSON.parse(texto); } catch { resposta = texto; }
  if (!r.ok) return { ok: false, status: r.status, resposta };
  return { ok: true, status: r.status, resposta };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node test/test_slput.mjs`
Expected: TODOS OS TESTES VERDES

- [ ] **Step 5: Commit**

```bash
git add src/superlogica_write.mjs test/test_slput.mjs
git commit -m "feat(write): slPut com gate DRY_RUN_WRITES (form-urlencoded)"
```

---

## Chunk 4: Motor genérico + ação de cadastro

### Task 7: Registry de WriteActions

**Files:**
- Create: `src/write/registry.mjs`
- Test: `test/test_registry.mjs`

- [ ] **Step 1: Escrever o teste**

Create `test/test_registry.mjs`:
```javascript
// test_registry.mjs
import { registerAction, getAction, WRITE_ACTIONS } from '../src/write/registry.mjs';
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

registerAction({ id: 'fake', validar: () => ({ ok: true, erros: [] }) });
ok(getAction('fake')?.id === 'fake', 'registra e recupera por id');
ok(getAction('nao_existe') === undefined, 'id desconhecido = undefined');
ok(typeof WRITE_ACTIONS === 'object', 'WRITE_ACTIONS exposto');
console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `node test/test_registry.mjs` → FALHA

- [ ] **Step 3: Implementar**

Create `src/write/registry.mjs`:
```javascript
// registry.mjs — mapa id -> WriteAction. Cada ação se registra; o engine só consulta.
export const WRITE_ACTIONS = {};
export function registerAction(a) { WRITE_ACTIONS[a.id] = a; return a; }
export function getAction(id) { return WRITE_ACTIONS[id]; }
```

- [ ] **Step 4: Rodar e ver passar** — Run: `node test/test_registry.mjs` → VERDES

- [ ] **Step 5: Commit**

```bash
git add src/write/registry.mjs test/test_registry.mjs
git commit -m "feat(write): registry de WriteActions"
```

---

### Task 8: Ação cadastro_inquilino — partes PURAS (validar + montarPayload)

**Files:**
- Create: `src/write/actions/cadastro_inquilino.mjs` (parcial)
- Test: `test/test_cadastro_inquilino.mjs`

- [ ] **Step 1: Escrever o teste**

Create `test/test_cadastro_inquilino.mjs`:
```javascript
// test_cadastro_inquilino.mjs — validações + payload (puros, sem rede)
import { cadastroInquilino } from '../src/write/actions/cadastro_inquilino.mjs';
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

// validar: campos obrigatórios
ok(cadastroInquilino.validar({}).ok === false, 'vazio é inválido');
const base = { id_condominio: '179', id_unidade: '900', nome: 'João Silva', papel: 'inquilino', data_entrada: '06/30/2026' };
ok(cadastroInquilino.validar(base).ok === true, 'campos obrigatórios → válido');
ok(cadastroInquilino.validar({ ...base, data_entrada: '30/06/2026' }).ok === false, 'data fora de MM/DD/AAAA → inválido');
ok(cadastroInquilino.validar({ ...base, papel: 'sindico' }).ok === false, 'papel inválido rejeitado');

// montarPayload: LABEL e obrigatórios
const p = cadastroInquilino.montarPayload(base);
ok(p['contatos[0][ST_NOME_CON]'] === 'João Silva', 'nome mapeado');
ok(p['contatos[0][ID_LABEL_TRES]'] === '7', 'inquilino → LABEL 7');
ok(cadastroInquilino.montarPayload({ ...base, papel: 'dependente' })['contatos[0][ID_LABEL_TRES]'] === '4', 'dependente → LABEL 4');
ok(p['contatos[0][DT_ENTRADA_RES]'] === '06/30/2026', 'data MM/DD/AAAA preservada');
ok(!('contatos[0][ST_EMAIL_CON]' in p), 'opcional ausente não vai no payload');
ok('contatos[0][ST_EMAIL_CON]' in cadastroInquilino.montarPayload({ ...base, email: 'a@b.com' }), 'opcional presente entra');

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `node test/test_cadastro_inquilino.mjs` → FALHA

- [ ] **Step 3: Implementar (parte pura)**

Create `src/write/actions/cadastro_inquilino.mjs`:
```javascript
// cadastro_inquilino.mjs — WriteAction #1. Cadastra inquilino/residente ou dependente numa unidade.
import { registerAction } from '../registry.mjs';

const DATA_RE = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/; // MM/DD/AAAA

// nomes EXATOS dos campos opcionais a confirmar em descoberta/api-superlogica-doc.md (pág 26-27)
const MAP_OPCIONAIS = {
  email: 'contatos[0][ST_EMAIL_CON]',
  telefone: 'contatos[0][ST_TELEFONE_CON]',
  cpf: 'contatos[0][ST_CPFCNPJ_CON]',
};

function validar(d) {
  const erros = [];
  for (const k of ['id_condominio', 'id_unidade', 'nome', 'data_entrada']) if (!d?.[k]) erros.push(`faltou ${k}`);
  if (d?.papel && !['inquilino', 'dependente'].includes(d.papel)) erros.push('papel inválido');
  if (d?.data_entrada && !DATA_RE.test(d.data_entrada)) erros.push('data_entrada deve ser MM/DD/AAAA');
  return { ok: erros.length === 0, erros };
}

function montarPayload(d) {
  const p = {
    idCondominio: String(d.id_condominio),
    idUnidade: String(d.id_unidade),
    'contatos[0][ST_NOME_CON]': d.nome,
    'contatos[0][DT_ENTRADA_RES]': d.data_entrada,
    'contatos[0][ID_LABEL_TRES]': d.papel === 'dependente' ? '4' : '7',
    'contatos[0][ID_TIPORESP_TRES]': '4', // NÃO_RECEBER (default p/ inquilino; confirmar regra contábil — spec §13#4)
    'contatos[0][ID_TIPOCONTATO_TCON]': '1', // condômino
  };
  for (const [campo, chave] of Object.entries(MAP_OPCIONAIS)) if (d[campo]) p[chave] = d[campo];
  return p;
}

export const cadastroInquilino = {
  id: 'cadastro_inquilino',
  descricao: 'Cadastrar inquilino/residente ou dependente numa unidade',
  timeAprovador: 'Recepção',
  validar,
  montarPayload,
  // checarConflito, snapshot, gravar, render → Task 9
};
registerAction(cadastroInquilino);
```

- [ ] **Step 4: Rodar e ver passar** — Run: `node test/test_cadastro_inquilino.mjs` → VERDES

- [ ] **Step 5: Commit**

```bash
git add src/write/actions/cadastro_inquilino.mjs test/test_cadastro_inquilino.mjs
git commit -m "feat(write): ação cadastro_inquilino (validar + montarPayload)"
```

---

### Task 9: Ação cadastro_inquilino — IO (checarConflito, snapshot, gravar, render)

IO injetável (`io`) p/ testar sem rede.

**Files:**
- Modify: `src/write/actions/cadastro_inquilino.mjs`
- Modify: `test/test_cadastro_inquilino.mjs` (acrescentar casos)

- [ ] **Step 1: Acrescentar testes (com io fake)**

Adicionar ao `test/test_cadastro_inquilino.mjs` antes do bloco final:
```javascript
// IO injetável
const ioFake = {
  responsaveisIndex: async () => ([{ id_unidade_uni: '900', st_cpfcnpj_con: '11122233344', st_nome_con: 'João Silva' }]),
  slPut: async () => ({ ok: true, dryRun: true, echo: {} }),
};
const conf = await cadastroInquilino.checarConflito({}, { ...base, cpf: '11122233344' }, ioFake);
ok(conf.conflito === true, 'CPF já presente na unidade → conflito');
const semConf = await cadastroInquilino.checarConflito({}, { ...base, cpf: '99999999999' }, ioFake);
ok(semConf.conflito === false, 'CPF novo → sem conflito');
const snap = await cadastroInquilino.snapshot({}, base, ioFake);
ok(Array.isArray(snap) && snap.length === 1, 'snapshot lista contatos da unidade');
const g = await cadastroInquilino.gravar(cadastroInquilino.montarPayload(base), { dados: base, io: ioFake });
ok(g.ok === true, 'gravar usa slPut injetado (DRY_RUN)');
const rnd = cadastroInquilino.render(base, snap);
ok(Array.isArray(rnd.campos) && rnd.campos.length > 0, 'render retorna campos p/ o painel');
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `node test/test_cadastro_inquilino.mjs` → FALHA (funções ausentes)

- [ ] **Step 3: Implementar (acrescentar à action; ajustar export)**

Adicionar imports no topo:
```javascript
import { responsaveisIndex as _respIndex } from '../../superlogica.mjs';
import { slPut as _slPut } from '../../superlogica_write.mjs';
```
Adicionar funções e plugá-las no objeto `cadastroInquilino`:
```javascript
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '').trim();

async function snapshot(ctx, d, io = {}) {
  const respIndex = io.responsaveisIndex || _respIndex;
  return respIndex(d.id_condominio, d.id_unidade);
}

async function checarConflito(ctx, d, io = {}) {
  const atuais = await snapshot(ctx, d, io);
  const candidatos = atuais.filter((c) =>
    (d.cpf && String(c.st_cpfcnpj_con || '').replace(/\D/g, '') === String(d.cpf).replace(/\D/g, '')) ||
    (!d.cpf && norm(c.st_nome_con) === norm(d.nome))
  );
  return { conflito: candidatos.length > 0, detalhe: candidatos.length ? 'já existe contato semelhante na unidade' : '', candidatos };
}

async function gravar(payload, { dados, io = {} } = {}) {
  const put = io.slPut || _slPut;
  const res = await put('unidades/post', payload);
  if (!res.ok) return { ok: false, resposta: res.resposta, status: res.status };
  // ID do contato criado é indocumentado → reler e casar (match não único → registra candidatos, não adivinha)
  let idCriado = null, candidatosId = [];
  if (!res.dryRun && dados) {
    try {
      const depois = await (io.responsaveisIndex || _respIndex)(dados.id_condominio, dados.id_unidade);
      candidatosId = depois.filter((c) =>
        (dados.cpf && String(c.st_cpfcnpj_con || '').replace(/\D/g, '') === String(dados.cpf).replace(/\D/g, '')) ||
        norm(c.st_nome_con) === norm(dados.nome)
      ).map((c) => c.id_contato_con);
      idCriado = candidatosId.length === 1 ? candidatosId[0] : null;
    } catch {}
  }
  return { ok: true, dryRun: !!res.dryRun, resposta: res.resposta, idCriado, candidatosId };
}

function render(d, snap) {
  return {
    campos: [
      { label: 'Condomínio', valor: d.id_condominio },
      { label: 'Unidade', valor: d.id_unidade },
      { label: 'Nome', valor: d.nome },
      { label: 'Papel', valor: d.papel === 'dependente' ? 'Dependente' : 'Inquilino/Residente' },
      { label: 'Entrada', valor: d.data_entrada },
      { label: 'E-mail', valor: d.email || '—' },
      { label: 'Telefone', valor: d.telefone || '—' },
      { label: 'CPF', valor: d.cpf || '—' },
    ],
    diff: [{ tipo: 'add', texto: `+ novo contato "${d.nome}" na unidade ${d.id_unidade}` }],
    snapshotResumo: `${(snap || []).length} contato(s) hoje na unidade`,
  };
}

Object.assign(cadastroInquilino, { checarConflito, snapshot, gravar, render });
```
> Confirme os nomes de coluna do `responsaveis/index` (`st_cpfcnpj_con`, `st_nome_con`, `id_contato_con`) em `descoberta/superlogica-api-live-map.md` e ajuste se divergir.

- [ ] **Step 4: Rodar e ver passar** — Run: `node test/test_cadastro_inquilino.mjs` → VERDES

- [ ] **Step 5: Commit**

```bash
git add src/write/actions/cadastro_inquilino.mjs test/test_cadastro_inquilino.mjs
git commit -m "feat(write): cadastro_inquilino IO (conflito/snapshot/gravar/render, io injetável)"
```

---

### Task 10: Engine (criar / aprovar / corrigir / rejeitar / notificar)

**Files:**
- Create: `src/write/engine.mjs`
- Test: `test/test_engine.mjs`

- [ ] **Step 1: Escrever o teste** (com uma WriteAction fake registrada)

Create `test/test_engine.mjs`:
```javascript
// test_engine.mjs — fluxo do motor com ação fake (sem rede)
import path from 'node:path'; import os from 'node:os';
process.env.AUDIT_LOG_PATH = path.join(os.tmpdir(), `eng_${Date.now()}.jsonl`); // setar ANTES dos imports que carregam config
const { registerAction } = await import('../src/write/registry.mjs');
const { criarRascunho, aprovarRascunho, rejeitarRascunho } = await import('../src/write/engine.mjs');
const { lerEventos } = await import('../src/write/auditoria.mjs');
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

let gravou = 0;
registerAction({
  id: 'fake', timeAprovador: 'Recepção',
  validar: (d) => ({ ok: !!d.nome, erros: d.nome ? [] : ['faltou nome'] }),
  checarConflito: async () => ({ conflito: false, candidatos: [] }),
  snapshot: async () => ([]),
  montarPayload: (d) => ({ nome: d.nome }),
  gravar: async () => { gravou++; return { ok: true, dryRun: true }; },
  render: () => ({ campos: [], diff: [] }),
});

const inval = await criarRascunho('fake', {}, {});
ok(inval.ok === false, 'rascunho inválido barrado antes de persistir');

const cr = await criarRascunho('fake', { nome: 'Z' }, { solicitante: { nome: 'Sol' } });
ok(cr.ok && cr.token && cr.urlAprovacao.includes('/aprovacao/'), 'cria rascunho + url de aprovação');

const ap = await aprovarRascunho(cr.token, { aprovador: 'maria' });
ok(ap.ok && ap.gravado && gravou === 1, 'aprovar grava 1x');
const ap2 = await aprovarRascunho(cr.token, { aprovador: 'maria' });
ok(ap2.jaGravado === true && gravou === 1, 'idempotente: 2ª aprovação não regrava');

const evs = await lerEventos({ draftId: cr.draftId });
ok(evs.some((e) => e.tipo === 'criado') && evs.some((e) => e.tipo === 'gravado'), 'auditou criado + gravado');

const cr2 = await criarRascunho('fake', { nome: 'Y' }, {});
const rj = await rejeitarRascunho(cr2.token, { aprovador: 'joao', motivo: 'sem vínculo' });
ok(rj.ok && (await lerEventos({ draftId: cr2.draftId })).some((e) => e.tipo === 'rejeitado'), 'rejeitar audita');

ok((await aprovarRascunho('inexistente', {})).ok === false, 'token inválido não grava');
console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
```
> Por que `await import()` dinâmico: `config.mjs` lê `AUDIT_LOG_PATH` no momento do import. Imports estáticos são *hoisted* e rodariam antes do `process.env.AUDIT_LOG_PATH = …`. `import path/os` (estáticos, sem dependência de env) ficam no topo; o resto entra por `await import()` após setar o env. Evita também o `require` em `.mjs` (que dá `ReferenceError`/`ERR_AMBIGUOUS_MODULE_SYNTAX` — gotcha do CLAUDE.md global).

- [ ] **Step 2: Rodar e ver falhar** — Run: `node test/test_engine.mjs` → FALHA

- [ ] **Step 3: Implementar**

Create `src/write/engine.mjs`:
```javascript
// engine.mjs — máquina genérica de escrita com aprovação. Agnóstica ao tipo de ação.
import { getAction } from './registry.mjs';
import { criarDraft, getDraftByToken, updateDraft } from './drafts.mjs';
import { registrarEvento } from './auditoria.mjs';
import { config } from '../config.mjs';

export async function criarRascunho(acaoId, dados, ctx = {}) {
  const acao = getAction(acaoId);
  if (!acao) return { ok: false, motivo: 'acao_desconhecida' };
  const v = acao.validar(dados);
  if (!v.ok) return { ok: false, motivo: 'invalido', erros: v.erros };
  const conflito = acao.checarConflito ? await acao.checarConflito(ctx, dados) : null;
  const snapshot = acao.snapshot ? await acao.snapshot(ctx, dados) : null;
  const draft = await criarDraft({
    acao: acaoId, dados, snapshot, conflito,
    solicitante: ctx.solicitante || null, time: acao.timeAprovador || 'Atendimento geral',
    origem: ctx.origem || null,
  });
  await registrarEvento({ tipo: 'criado', draftId: draft.id, acao: acaoId, solicitante: draft.solicitante, dados, conflito, snapshot });
  return {
    ok: true, draftId: draft.id, token: draft.token, time: draft.time, conflito,
    urlAprovacao: `${config.publicBase}/aprovacao/${draft.token}`,
  };
}

export async function aprovarRascunho(token, { aprovador, correcoes } = {}) {
  const draft = await getDraftByToken(token);
  if (!draft) return { ok: false, motivo: 'nao_encontrado' };
  if (draft.status === 'gravado') return { ok: true, jaGravado: true, draft };
  if (draft.status === 'rejeitado') return { ok: false, motivo: 'ja_rejeitado' };
  if (draft.expiraEm <= Date.now()) { await updateDraft(draft.id, { status: 'expirado' }); return { ok: false, motivo: 'expirado' }; }

  const acao = getAction(draft.acao);
  let dados = draft.dados;
  if (correcoes && Object.keys(correcoes).length) {
    dados = { ...dados, ...correcoes };
    await registrarEvento({ tipo: 'corrigido', draftId: draft.id, aprovador, diff: correcoes });
    await updateDraft(draft.id, { dados, expiraEm: Date.now() + config.approvalTtlH * 3600 * 1000 }); // corrigir reinicia SLA
  }
  const v = acao.validar(dados);
  if (!v.ok) return { ok: false, motivo: 'invalido', erros: v.erros };

  const payload = acao.montarPayload(dados); // computa 1x; reusa no gravar e na auditoria
  let res;
  try { res = await acao.gravar(payload, { dados }); }
  catch (e) {
    await updateDraft(draft.id, { status: 'erro' });
    await registrarEvento({ tipo: 'erro', draftId: draft.id, aprovador, detalhe: e.message });
    return { ok: false, motivo: 'erro_gravacao', detalhe: e.message };
  }
  if (!res.ok) {
    await updateDraft(draft.id, { status: 'erro' });
    await registrarEvento({ tipo: 'erro', draftId: draft.id, aprovador, resposta: res.resposta, status: res.status });
    return { ok: false, motivo: 'erro_gravacao', resposta: res.resposta };
  }
  await updateDraft(draft.id, { status: 'gravado', resultado: { idCriado: res.idCriado, candidatosId: res.candidatosId, dryRun: res.dryRun } });
  await registrarEvento({ tipo: 'gravado', draftId: draft.id, aprovador, payload, resposta: res.resposta, idCriado: res.idCriado, candidatosId: res.candidatosId, dryRun: res.dryRun, snapshot: draft.snapshot });
  await notificarMorador(draft, `✅ Seu cadastro foi concluído${res.dryRun ? ' (simulação)' : ''}.`);
  return { ok: true, gravado: true, dryRun: res.dryRun, draft, res };
}

export async function rejeitarRascunho(token, { aprovador, motivo } = {}) {
  const draft = await getDraftByToken(token);
  if (!draft) return { ok: false, motivo: 'nao_encontrado' };
  if (draft.status === 'gravado') return { ok: false, motivo: 'ja_gravado' };
  await updateDraft(draft.id, { status: 'rejeitado' });
  await registrarEvento({ tipo: 'rejeitado', draftId: draft.id, aprovador, detalhe: motivo || '' });
  await notificarMorador(draft, 'Sua solicitação foi revisada pela equipe e precisa de um ajuste; já entramos em contato.');
  return { ok: true, rejeitado: true };
}

// Notifica o morador no canal de origem. Sem buraco: se não houver canal/URL, registra como pendente.
async function notificarMorador(draft, mensagem) {
  try {
    if (draft.origem?.adapterNotify && config.adapterNotifyUrl) {
      await fetch(config.adapterNotifyUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conv: draft.origem.conv, mensagem }), signal: AbortSignal.timeout(10000),
      });
      return;
    }
  } catch (e) { console.warn('[engine] notificarMorador falhou:', e.message); }
  await registrarEvento({ tipo: 'confirmacao_pendente', draftId: draft.id, mensagem });
}
```

- [ ] **Step 4: Rodar e ver passar** — Run: `node test/test_engine.mjs` → VERDES

- [ ] **Step 5: Commit**

```bash
git add src/write/engine.mjs test/test_engine.mjs
git commit -m "feat(write): engine (criar/aprovar idempotente/corrigir-reinicia-SLA/rejeitar/notificar)"
```

---

## Chunk 5: Integração (tool da Ana + painel + adapter + e2e)

### Task 11: Tool `criar_rascunho_cadastro` na Ana

**Files:**
- Modify: `src/agent.mjs` (array `TOOLS`, `runToolReal` switch, retorno do loop)
- Modify: `server.mjs` (incluir `drafts` no JSON de `/chat-send`)
- Test: `test/test_tool_rascunho.mjs`

- [ ] **Step 1: Escrever o teste** (chama `runToolReal` direto com ctx fake)

Create `test/test_tool_rascunho.mjs`:
```javascript
// test_tool_rascunho.mjs — a tool cria rascunho e popula ctx.draft, sem write real (DRY_RUN)
process.env.DRY_RUN_WRITES = 'true';
import { runToolReal, TOOLS } from '../src/agent.mjs';
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

ok(TOOLS.some((t) => t.function.name === 'criar_rascunho_cadastro'), 'tool registrada em TOOLS');
const ctx = { chatId: null };
const r = await runToolReal('criar_rascunho_cadastro', { id_condominio: '179', id_unidade: '900', nome: 'João Silva', papel: 'inquilino', data_entrada: '06/30/2026' }, ctx);
ok(r.criado === true && r.aguardando_aprovacao === true, 'retorna criado + aguardando_aprovacao');
ok(Array.isArray(ctx.draft) && ctx.draft[0]?.url.includes('/aprovacao/'), 'ctx.draft populado com url');
const inval = await runToolReal('criar_rascunho_cadastro', { id_condominio: '179', nome: 'X' }, { chatId: null });
ok(inval.criado === false && Array.isArray(inval.erros), 'campos faltando → criado:false + erros');
console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `node test/test_tool_rascunho.mjs` → FALHA

- [ ] **Step 3: Implementar**

Em `src/agent.mjs`, importar o engine + a ação (o import registra a ação no registry):
```javascript
import * as ENGINE from './write/engine.mjs';
import './write/actions/cadastro_inquilino.mjs'; // side-effect: registerAction
```
Adicionar ao array `TOOLS` (mesmo formato das demais):
```javascript
  { type: 'function', function: { name: 'criar_rascunho_cadastro',
    description: 'Prepara o cadastro de um inquilino/residente ou dependente numa unidade. NÃO grava: monta o pedido e envia para a equipe aprovar antes de entrar no sistema. Use quando o morador pede para cadastrar alguém.',
    parameters: { type: 'object', properties: {
      id_condominio: { type: 'string' }, id_unidade: { type: 'string' },
      nome: { type: 'string' }, papel: { type: 'string', enum: ['inquilino', 'dependente'] },
      data_entrada: { type: 'string', description: 'MM/DD/AAAA' },
      email: { type: 'string' }, telefone: { type: 'string' }, cpf: { type: 'string' },
    }, required: ['id_unidade', 'nome', 'data_entrada'] } } },
```
Adicionar o `case` em `runToolReal`:
```javascript
case 'criar_rascunho_cadastro': {
  const idc = String(args.id_condominio || ctx.lastCondo?.id || '');
  const r = await ENGINE.criarRascunho('cadastro_inquilino', {
    id_condominio: idc, id_unidade: String(args.id_unidade || ''),
    nome: args.nome, papel: args.papel || 'inquilino', data_entrada: args.data_entrada,
    email: args.email, telefone: args.telefone, cpf: args.cpf,
  }, { solicitante: ctx.solicitante || null, origem: ctx.origem || null });
  if (!r.ok) return { criado: false, motivo: r.motivo, erros: r.erros || [] };
  (ctx.draft ||= []).push({ token: r.token, url: r.urlAprovacao, time: r.time, conflito: r.conflito,
    resumo: `Cadastro de ${args.nome} na unidade ${args.id_unidade}` });
  return { criado: true, protocolo: r.draftId, aguardando_aprovacao: true,
    aviso: r.conflito?.conflito ? 'já existe contato semelhante — a equipe vai conferir' : undefined };
}
```
**Propagar `drafts` em TODOS os returns que montam a resposta** (espelhando `attachments`) — este é o elo que entrega o draft à equipe; se faltar, vira silent failure:
- Em `src/agent.mjs`, `runAgentLoop` tem **dois** `return` que devolvem o objeto de resposta (`{ reply, … }`). Localize-os **por conteúdo** (busque `return { reply` dentro de `runAgentLoop`) e adicione `drafts: ctx.draft || []` em **ambos**.
- Em `server.mjs`, no handler `POST /chat-send`, localize o `return json(res, 200, { reply: … })` **por conteúdo** (não por nº de linha) e acrescente `drafts: r.drafts || []`:
```javascript
return json(res, 200, { reply: r.reply, transferred: !!r.transferred, attachments: r.attachments || [], drafts: r.drafts || [] });
```
> Verificação: após a edição, `node test/test_e2e_write.mjs` (Task 14) só passa se os drafts realmente trafegarem pelo `/chat-send`.

- [ ] **Step 4: Rodar e ver passar** — Run: `node test/test_tool_rascunho.mjs` → VERDES
  - Regressão: `node test/test_cobranca.mjs` (garante que TOOLS/agent não quebraram outras tools)

- [ ] **Step 5: Commit**

```bash
git add src/agent.mjs server.mjs test/test_tool_rascunho.mjs
git commit -m "feat(write): tool criar_rascunho_cadastro + ctx.draft propagado no /chat-send"
```

---

### Task 12: Painel de aprovação (rotas no server.mjs)

**Files:**
- Modify: `server.mjs` (rotas `GET /aprovacao/<token>` e `POST /aprovacao/<token>/{aprovar,corrigir,rejeitar}`)
- Create: `src/write/painel.mjs` (gera o HTML — mantém server.mjs enxuto)
- Test: `test/test_painel.mjs` (renderização pura + checagem de passcode)

- [ ] **Step 1: Escrever o teste**

Create `test/test_painel.mjs`:
```javascript
// test_painel.mjs — render do painel é puro e mostra os campos + ações
import { renderPainel, passcodeOk } from '../src/write/painel.mjs';
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

const draft = { token: 'tk', acao: 'cadastro_inquilino', status: 'pendente', time: 'Recepção',
  conflito: { conflito: true, detalhe: 'semelhante' },
  render: { campos: [{ label: 'Nome', valor: 'João' }], diff: [], snapshotResumo: '1 contato hoje' } };
const html = renderPainel(draft);
ok(html.includes('João') && html.includes('Recepção'), 'mostra dados + time');
ok(html.includes('Aprovar') && html.includes('Rejeitar'), 'tem botões de ação');
ok(html.toLowerCase().includes('semelhante'), 'mostra alerta de conflito');
ok(renderPainel(draft, 'seg123').includes('seg123'), 'injeta o passcode nos forms (p/ os POSTs)');
ok(passcodeOk('seg', 'seg') === true && passcodeOk('x', 'seg') === false, 'passcode confere');
console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `node test/test_painel.mjs` → FALHA

- [ ] **Step 3: Implementar**

Create `src/write/painel.mjs`:
```javascript
// painel.mjs — HTML do painel de aprovação (sem framework). `render` vem da WriteAction.
export function passcodeOk(fornecido, esperado) { return !!esperado && fornecido === esperado; }

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function renderPainel(draft, k = '') {
  const r = draft.render || { campos: [], diff: [] };
  const linhas = r.campos.map((c) => `<tr><th style="text-align:left;padding:4px 12px 4px 0">${esc(c.label)}</th><td>${esc(c.valor)}</td></tr>`).join('');
  const alerta = draft.conflito?.conflito ? `<p style="background:#fde68a;padding:8px;border-radius:6px">⚠️ ${esc(draft.conflito.detalhe || 'possível duplicidade — confira')}</p>` : '';
  const jaResolvido = draft.status !== 'pendente' ? `<p>Status: <b>${esc(draft.status)}</b> (nenhuma ação disponível)</p>` : '';
  const acoes = draft.status === 'pendente' ? `
    <form method="POST" action="/aprovacao/${esc(draft.token)}/aprovar"><input type="hidden" name="k" value="${esc(k)}"><input name="aprovador" placeholder="Seu nome" required><button>Aprovar</button></form>
    <form method="POST" action="/aprovacao/${esc(draft.token)}/rejeitar"><input type="hidden" name="k" value="${esc(k)}"><input name="aprovador" placeholder="Seu nome" required><input name="motivo" placeholder="Motivo"><button>Rejeitar</button></form>` : '';
  return `<!doctype html><meta charset="utf-8"><title>Aprovação — ${esc(draft.acao)}</title>
<body style="font-family:system-ui;max-width:560px;margin:40px auto">
<h2>Aprovar escrita — ${esc(draft.time)}</h2>${alerta}
<table>${linhas}</table><p><small>${esc(r.snapshotResumo || '')}</small></p>
${jaResolvido}${acoes}</body>`;
}
```
> `renderPainel(draft, k)` recebe o passcode e o injeta (escapado) nos `value` dos hidden inputs, para os POSTs de aprovar/corrigir/rejeitar reusarem. Em produção, considerar CSRF/token de form; v1 usa o passcode compartilhado.

Em `server.mjs`, adicionar ANTES do fallback 404 (seguir o estilo do bloco `/cnd/`):
```javascript
// Painel de aprovação (equipe) — protegido por passcode ?k=
if (req.method === 'GET' && req.url.startsWith('/aprovacao/')) {
  const { renderPainel, passcodeOk } = await import('./src/write/painel.mjs');
  const { getDraftByToken } = await import('./src/write/drafts.mjs');
  const { getAction } = await import('./src/write/registry.mjs');
  const u = new URL(req.url, 'http://x'); const token = u.pathname.slice('/aprovacao/'.length).split('/')[0];
  const k = u.searchParams.get('k') || '';
  if (!passcodeOk(k, config.approvalPasscode)) { res.writeHead(401, { 'Content-Type': 'text/html' }); return res.end('<p>Passcode inválido. Use ?k=…</p>'); }
  const draft = await getDraftByToken(token);
  if (!draft) { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end('<p>Rascunho não encontrado ou expirado.</p>'); }
  const acao = getAction(draft.acao);
  if (acao?.render) draft.render = acao.render(draft.dados, draft.snapshot);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  return res.end(renderPainel(draft, k)); // renderPainel escapa o passcode internamente (esc), sem precisar de esc no server
}
if (req.method === 'POST' && req.url.startsWith('/aprovacao/')) {
  const { aprovarRascunho, rejeitarRascunho } = await import('./src/write/engine.mjs');
  const { passcodeOk } = await import('./src/write/painel.mjs');
  const u = new URL(req.url, 'http://x'); const parts = u.pathname.split('/'); const token = parts[2]; const op = parts[3];
  const body = new URLSearchParams((await readBody(req)) || '');
  if (!passcodeOk(body.get('k') || '', config.approvalPasscode)) return json(res, 401, { erro: 'passcode' });
  const aprovador = body.get('aprovador') || 'equipe';
  let out;
  if (op === 'aprovar') out = await aprovarRascunho(token, { aprovador });
  else if (op === 'rejeitar') out = await rejeitarRascunho(token, { aprovador, motivo: body.get('motivo') || '' });
  else if (op === 'corrigir') { const correcoes = {}; for (const [kk, vv] of body) if (!['k', 'aprovador'].includes(kk)) correcoes[kk] = vv; out = await aprovarRascunho(token, { aprovador, correcoes }); }
  else return json(res, 404, { erro: 'op' });
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  return res.end(`<p>${out.ok ? 'Pronto: ' + (out.gravado ? 'gravado' + (out.dryRun ? ' (simulação)' : '') : out.rejeitado ? 'rejeitado' : 'ok') : 'Falhou: ' + (out.motivo || '')}</p>`);
}
```
> `renderPainel(draft, k)` recebe o passcode e o escapa internamente (a `esc` vive em `painel.mjs`); o server **não** precisa de `esc`. O `k` já foi validado contra `config.approvalPasscode` antes de chegar aqui.

- [ ] **Step 4: Rodar e ver passar** — Run: `node test/test_painel.mjs` → VERDES

- [ ] **Step 5: Commit**

```bash
git add server.mjs src/write/painel.mjs test/test_painel.mjs
git commit -m "feat(write): painel de aprovação (GET render + POST aprovar/corrigir/rejeitar, passcode)"
```

---

### Task 13: Adapter Chatwoot — entrega de `ctx.draft` + `/notify` (CROSS-REPO)

⚠️ Arquivo em `<raiz NCS>/.tmp/chatwoot_adapter.mjs`, **fora do repo git** do agente-service. Deploy próprio (stack/túnel do Chatwoot). Não entra nos commits acima.

**Files:**
- Modify: `<raiz NCS>/.tmp/chatwoot_adapter.mjs`

- [ ] **Step 1: Implementar a entrega do draft** (espelhar `deliverAttachments`)

Após ler a resposta de `/chat-send` (onde hoje pega `attachments`), pegar também `drafts` e, para cada um, postar **nota interna** com o link e aplicar **label do time**, guardando `conv↔token` para o `/notify`:
```javascript
const draftConv = new Map(); // token -> conv (p/ confirmar ao morador depois)
async function deliverDrafts(conv, drafts) {
  for (const d of (drafts || [])) {
    if (!d || !d.url) continue;
    draftConv.set(d.token, conv);
    const nota = `📝 *Pré-cadastro aguardando aprovação* (${d.time})\n${d.resumo}\n${d.conflito?.conflito ? '⚠️ possível duplicidade — confira\n' : ''}Aprovar: ${d.url}?k=<PASSCODE>`;
    try { await cw(`/conversations/${conv}/messages`, { content: nota, message_type: 'outgoing', private: true }, ADMIN_TOKEN); } catch (e) { console.error('draft nota err', e.message); }
    try { await applyLabel(conv, 'aprovacao-pendente'); } catch {}
  }
}
```
Chamar `await deliverDrafts(conv, resp.drafts)` junto de `deliverAttachments`. Ao montar o `ctx`/payload enviado ao `/chat-send`, incluir `origem: { canal: 'chatwoot', conv, adapterNotify: true }` para o engine saber notificar de volta.

- [ ] **Step 2: Endpoint `/notify` (engine → adapter → morador)**

No servidor http do adapter, adicionar rota protegida por secret (mesmo padrão do `/hook/<secret>`):
```javascript
// POST /notify/<secret> { conv, mensagem } → posta mensagem pública ao morador
if (req.method === 'POST' && req.url.startsWith('/notify/')) {
  const secret = req.url.split('/')[2];
  if (secret !== NOTIFY_SECRET) { res.writeHead(403); return res.end('no'); }
  const { conv, mensagem } = JSON.parse(await readBody(req) || '{}');
  await postMessage(conv, mensagem); res.writeHead(200); return res.end('ok');
}
```
Definir `NOTIFY_SECRET` (lido de `.tmp/chatwoot_notify_secret.txt`) e configurar `ADAPTER_NOTIFY_URL=https://chatwoot-bot.dynamicagents.tech/notify/<secret>` no env do agente-service.

- [ ] **Step 3: Smoke do adapter** (sem subir a stack)

Run (de `<raiz NCS>`): `node .tmp/chatwoot_adapter_verify.mjs`
Expected: funções presentes, sem crash de import (guard de entrypoint já existe no adapter).

- [ ] **Step 4: (sem teste unitário formal — cross-repo)** Validar no e2e da Task 14.

- [ ] **Step 5: (sem commit no repo agente-service)** — versionar o adapter conforme a convenção do projeto (`.tmp/`, não-git).

---

### Task 14: e2e em DRY_RUN (criar → aprovar → auditoria)

**Files:**
- Create: `test/test_e2e_write.mjs`

- [ ] **Step 1: Escrever o e2e** (usa engine + tool + DRY_RUN, sem rede externa)

Create `test/test_e2e_write.mjs`:
```javascript
// test_e2e_write.mjs — caminho feliz ponta a ponta em DRY_RUN
process.env.DRY_RUN_WRITES = 'true';
import path from 'node:path'; import os from 'node:os'; import fs from 'node:fs';
process.env.AUDIT_LOG_PATH = path.join(os.tmpdir(), `e2e_${Date.now()}.jsonl`);
const { runToolReal } = await import('../src/agent.mjs');
const { aprovarRascunho } = await import('../src/write/engine.mjs');
const { lerEventos } = await import('../src/write/auditoria.mjs');
// e2e sem rede: sobrescreve as funções de IO da ação (snapshot/checarConflito) por stubs.
// Mutar propriedades do objeto exportado é OK (mexe na propriedade, não na binding ESM). Feito ANTES do runToolReal.
const mod = await import('../src/write/actions/cadastro_inquilino.mjs');
mod.cadastroInquilino.snapshot = async () => ([]);
mod.cadastroInquilino.checarConflito = async () => ({ conflito: false, candidatos: [] });

let falhas = 0; const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };
const ctx = { chatId: null };
const r = await runToolReal('criar_rascunho_cadastro', { id_condominio: '181', id_unidade: '900', nome: 'Maria Teste', data_entrada: '10/06/2026' }, ctx);
ok(r.criado === true, 'tool criou rascunho');
const token = ctx.draft[0].token;
const ap = await aprovarRascunho(token, { aprovador: 'Recepção' });
ok(ap.ok && ap.gravado && ap.dryRun === true, 'aprovado e gravado em DRY_RUN');
const evs = await lerEventos({ draftId: r.protocolo });
ok(evs.some((e) => e.tipo === 'criado') && evs.some((e) => e.tipo === 'gravado'), 'auditoria completa');
try { fs.unlinkSync(process.env.AUDIT_LOG_PATH); } catch {}
console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
```

- [ ] **Step 2: Rodar e ver passar** — Run: `node test/test_e2e_write.mjs` → VERDES
  - Suíte: `for t in test/test_*.mjs; do node "$t" || break; done` (Bash) — todos verdes.

- [ ] **Step 3: Commit**

```bash
git add test/test_e2e_write.mjs
git commit -m "test(write): e2e DRY_RUN criar→aprovar→auditoria"
```

---

## Chunk 6: Rollout & gate-zero (sem ligar escrita real ainda)

### Task 15: Env de deploy + script do gate-zero (pronto p/ quando a credencial chegar)

**Files:**
- Modify: `<raiz NCS>/.tmp/portainer_redeploy_string.mjs` (lista fixa de env)
- Create: `<raiz NCS>/.tmp/superlogica_write_probe.mjs`
- Modify: `docs/superpowers/specs/2026-06-29-motor-escritas-aprovacao-design.md` (marcar rollout em andamento) — opcional

- [ ] **Step 1: Adicionar env novas à lista fixa do redeploy** (senão não chegam em prod):
`DRY_RUN_WRITES` (manter `true`), `AUDIT_LOG_PATH` (apontar p/ volume persistente), `APPROVAL_PASSCODE`, `APPROVAL_TTL_H`, `ADAPTER_NOTIFY_URL`, e (vazias por ora) `SUPERLOGICA_WRITE_APP_TOKEN`/`SUPERLOGICA_WRITE_ACCESS_TOKEN`. Garantir um **volume** mapeado para o diretório de `AUDIT_LOG_PATH` no compose (auditoria não pode viver em camada efêmera).

- [ ] **Step 2: Script do gate-zero** (NÃO rodar até a credencial de escrita existir e numa unidade combinada com o Fernando):

Create `<raiz NCS>/.tmp/superlogica_write_probe.mjs` — cria contato de teste → confere no `responsaveis/index` → `DELETE /contatos/delete`. Critério objetivo de "passou" (anti-silent-failure, spec §10): `PUT` 200 **e** contato aparece **e** `DELETE` confirma sumiço. Rodar com `dangerouslyDisableSandbox:true`. Imprimir um resumo (nunca PII crua).

- [ ] **Step 3: Deploy em DRY_RUN** (loop padrão do projeto, quando autorizado):
`git push` → `node .tmp/poll_build.mjs` (conferir o SHA do commit) → `node .tmp/portainer_redeploy_string.mjs` → `node .tmp/verify_chat.mjs`. ⚠️ Deploy é autorização por-versão — **pedir ao usuário antes de push/deploy**.

- [ ] **Step 4: Validar em prod (DRY_RUN):** criar um rascunho pelo `/chat?k=…`, abrir o link `/aprovacao/<token>?k=…`, aprovar, conferir resposta "gravado (simulação)" e o evento no log de auditoria (volume).

- [ ] **Step 5: Commit** (somente arquivos do repo, se houver; scripts `.tmp/` seguem a convenção não-git):

```bash
git commit --allow-empty -m "chore(write): rollout DRY_RUN documentado; gate-zero pronto p/ credencial de escrita"
```

---

## Sequenciamento & dependências

- **Chunk 1 → 2 → 3 → 4 → 5 → 6**, nessa ordem (cada um depende do anterior).
- Dentro de um chunk, as tasks são sequenciais.
- Pré-requisitos do CLIENTE (não bloqueiam Chunks 1-5, todos em DRY_RUN): usuário de serviço com escrita (Rodrigo), unidade de teste (Fernando) — entram só na Task 15 / Fase B.

## Definition of Done (v1)
- Todos os `test/test_*.mjs` verdes (incl. e2e em DRY_RUN).
- A Ana cria rascunho de cadastro; equipe aprova/rejeita pelo painel; auditoria durável registra todo o ciclo; nada grava de verdade enquanto `DRY_RUN_WRITES=true`.
- Nenhuma credencial de escrita no alcance do `$fromAI`.
- **Nomes de campo/coluna confirmados na doc ANTES do gate-zero** (verificação obrigatória, não opcional): campos opcionais do `contatos[0]` e `ID_TIPOCONTATO_*` em `descoberta/api-superlogica-doc.md` (pág 26-27); colunas `st_cpfcnpj_con`/`st_nome_con`/`id_contato_con` em `descoberta/superlogica-api-live-map.md` — conflito/auditoria/reversão dependem disso.
- **Env novas adicionadas à lista fixa do `.tmp/portainer_redeploy_string.mjs`** (gotcha #1 do CLAUDE.md: var fora da lista NÃO chega em prod) + volume mapeado para `AUDIT_LOG_PATH`.
- `git status` limpo; deploy em DRY_RUN só após autorização do usuário.
