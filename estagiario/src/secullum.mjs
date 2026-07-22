// secullum.mjs (Chat NCS) — LEITURA de ponto / afastamento dos terceirizados no Secullum Ponto Web,
// insumo do RH. SOMENTE GET. Env-gated: sem SECULLUM_USER/PASS a tool responde "indisponível" (não
// derruba o serviço, no molde do Autentique). Anti-alucinação: todo dado vem da API; as funções de
// matching/resumo são PURAS e testáveis sem rede/PII (test/test_secullum.mjs).
//
// Gotchas MEDIDOS ao vivo 22/07 (descoberta/secullum-api-map.md):
//   • auth ROPC: POST /Token, grant_type=password, client_id=3 (NÃO o 1 do link do painel);
//   • header secullumidbancoselecionado = id NUMÉRICO do banco (107803) — o GUID `identificador` dá 401;
//   • datas em ISO YYYY-MM-DD (dd/MM/yyyy dá HTTP 400 — ao contrário da Superlógica).
import { config } from "../../src/config.mjs";

const TIMEOUT = parseInt(process.env.SECULLUM_TIMEOUT_MS || "15000", 10);
const to = () => AbortSignal.timeout(TIMEOUT);

// gating puro (testável sem mexer no config singleton): _disponivel(cfg) → _configurado() usa o config real
export function _disponivel(cfg) { return !!(cfg && cfg.secullumUser && cfg.secullumPass); }
export function _configurado() { return _disponivel(config); }

// ---------- helpers puros ----------
const soDig = (s) => String(s ?? "").replace(/\D/g, "");
const normNome = (s) => String(s ?? "").toLowerCase().normalize("NFD")
  .replace(new RegExp("[\\u0300-\\u036f]", "g"), "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const mascCpf = (c) => { const d = soDig(c); return d.length >= 11 ? `***.***.${d.slice(6, 9)}-${d.slice(9, 11)}` : "***"; };
function hhmm(v) { if (!v) return null; const m = String(v).match(/(\d{2}):(\d{2})/); return m ? `${m[1]}:${m[2]}` : String(v); }
function primeiro(o, campos) { for (const c of campos) if (o[c]) return o[c]; return null; }

/** ISO a partir do que o LLM mandar (aceita ISO e, defensivo, dd/MM/yyyy → a API só engole ISO). */
export function _normData(s) {
  const t = String(s ?? "").trim();
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return t;
}

/** Período da consulta. Sem datas: afastamentos = -7d..+30d (pega quem está/vai entrar de férias);
 * ponto = últimos 30 dias. deps.now (ms) torna testável. */
export function _periodo(args = {}, assunto = "afastamentos", nowMs) {
  const iso = (d) => new Date(d).toISOString().slice(0, 10);
  if (args.data_inicio && args.data_fim) return { inicio: _normData(args.data_inicio), fim: _normData(args.data_fim) };
  const hoje = nowMs != null ? nowMs : Date.now();
  const dia = 86400000;
  if (assunto === "afastamentos") return { inicio: iso(hoje - 7 * dia), fim: iso(hoje + 30 * dia) };
  return { inicio: iso(hoje - 30 * dia), fim: iso(hoje) };
}

/** Acha 1 colaborador por CPF (só dígitos, >=11) ou por nome (todos os tokens presentes). Puro.
 * Exato normalizado vence; contains como fallback; >1 = ambiguo (devolve opções, nunca escolhe). */
export function _acharFuncionario(funcs, termo) {
  const t = String(termo ?? "").trim();
  if (!t) return { status: "sem_termo" };
  const dig = soDig(t);
  if (dig.length >= 11) {
    const hit = funcs.filter((f) => soDig(f.Cpf) === dig);
    return hit.length ? { status: "ok", funcionario: hit[0] } : { status: "nao_encontrado" };
  }
  const q = normNome(t);
  let hit = funcs.filter((f) => normNome(f.Nome) === q);
  if (!hit.length) {
    const toks = q.split(" ").filter(Boolean);
    if (toks.length) hit = funcs.filter((f) => { const n = normNome(f.Nome); return toks.every((k) => n.includes(k)); });
  }
  if (!hit.length) return { status: "nao_encontrado" };
  if (hit.length > 1) return { status: "ambiguo", opcoes: hit.slice(0, 8).map((f) => ({ nome: f.Nome, matricula: f.NumeroFolha })) };
  return { status: "ok", funcionario: hit[0] };
}

/** Índices p/ cruzar afastamento/batida → funcionário (o afastamento NÃO traz o nome, só Cpf/Pis/Folha). */
export function _indexFuncionarios(funcs) {
  const porCpf = new Map(), porPis = new Map(), porId = new Map(), porFolha = new Map();
  for (const f of funcs) {
    if (f.Cpf) porCpf.set(soDig(f.Cpf), f);
    if (f.NumeroPis) porPis.set(soDig(f.NumeroPis), f);
    if (f.Id != null) porId.set(String(f.Id), f);
    if (f.NumeroFolha) porFolha.set(String(f.NumeroFolha).trim(), f);
  }
  return { porCpf, porPis, porId, porFolha };
}

/** Afastamentos → [{nome, inicio, fim, motivo}], nome resolvido pelo índice (CPF mascarado se não achar). */
export function _resumoAfastamentos(afast, idx, { cpf } = {}) {
  let arr = afast;
  if (cpf) { const d = soDig(cpf); arr = arr.filter((a) => soDig(a.Cpf) === d); }
  return arr.map((a) => {
    const f = idx.porCpf.get(soDig(a.Cpf)) || idx.porPis.get(soDig(a.NumeroPis));
    return {
      nome: f?.Nome || `(colaborador ${mascCpf(a.Cpf)})`,
      inicio: String(a.Inicio || "").slice(0, 10),
      fim: String(a.Fim || "").slice(0, 10),
      motivo: a.Motivo || a.JustificativaNome || "afastamento",
    };
  }).sort((x, y) => (x.inicio < y.inicio ? -1 : x.inicio > y.inicio ? 1 : 0));
}

/** Batidas de 1 funcionário → [{data, entrada, saida}] (1ª entrada / última saída do dia). Puro. */
export function _resumoBatidas(batidas, funcionarioId) {
  const fid = String(funcionarioId);
  return batidas.filter((b) => String(b.FuncionarioId) === fid).map((b) => {
    const ent = primeiro(b, ["Entrada1", "Entrada2", "Entrada3", "Entrada4", "Entrada5"]);
    const saidas = ["Saida5", "Saida4", "Saida3", "Saida2", "Saida1"].map((c) => b[c]).filter(Boolean);
    return { data: String(b.Data || "").slice(0, 10), entrada: hhmm(ent), saida: hhmm(saidas[0] || null) };
  }).sort((x, y) => (x.data < y.data ? -1 : x.data > y.data ? 1 : 0));
}

// ---------- I/O (auth ROPC cacheada + GET) ----------
let _tok = null; // { token, expira }
async function token() {
  const now = Date.now();
  if (_tok && _tok.expira > now) return _tok.token;
  const body = new URLSearchParams({ grant_type: "password", username: config.secullumUser, password: config.secullumPass, client_id: config.secullumClientId });
  const r = await fetch(`${config.secullumAuthBase}/Token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: to() });
  if (!r.ok) throw new Error(`Secullum /Token ${r.status}`);
  const j = await r.json();
  if (!j.access_token) throw new Error("Secullum /Token sem access_token");
  _tok = { token: j.access_token, expira: now + Math.max(60, (j.expires_in || 3600) - 120) * 1000 };
  return _tok.token;
}

async function skGet(path, params = {}) {
  let t = await token();
  const qs = new URLSearchParams(params).toString();
  const url = `${config.secullumDadosBase}/${path}${qs ? "?" + qs : ""}`;
  const H = () => ({ Authorization: `Bearer ${t}`, secullumidbancoselecionado: config.secullumBanco, "Accept-Language": "pt-BR" });
  let r = await fetch(url, { headers: H(), signal: to() });
  if (r.status === 401) { _tok = null; t = await token(); r = await fetch(url, { headers: H(), signal: to() }); } // token venceu → 1 retry
  if (!r.ok) throw new Error(`Secullum ${path} ${r.status}`);
  return r.json();
}

let _funcs = null, _funcsAt = 0;
async function listarFuncionarios(deps = {}) {
  if (deps.funcionarios) return deps.funcionarios; // seam de teste
  const now = Date.now();
  if (_funcs && now - _funcsAt < 10 * 60 * 1000) return _funcs;
  _funcs = await skGet("Funcionarios");
  _funcsAt = now;
  return _funcs;
}

/** consultar_ponto(args, deps) — tool do Estagiário. deps injeta funcionarios/afastamentos/batidas p/ teste.
 * args: { assunto?: 'afastamentos'|'ponto'|'funcionario', funcionario?, data_inicio?, data_fim? }. */
export async function consultar_ponto(args = {}, deps = {}) {
  if (!_configurado()) return { disponivel: false, motivo: "a integração de ponto (Secullum) ainda não está configurada" };
  const assunto = args.assunto || (args.funcionario ? "ponto" : "afastamentos");
  try {
    const funcs = await listarFuncionarios(deps);
    const idx = _indexFuncionarios(funcs);

    let alvo = null;
    if (args.funcionario) {
      const r = _acharFuncionario(funcs, args.funcionario);
      if (r.status === "ambiguo") return { disponivel: true, encontrado: false, motivo: "ambiguo", opcoes: r.opcoes, detalhe: `mais de um colaborador bate com "${args.funcionario}" — confirme qual (nome completo ou matrícula)` };
      if (r.status !== "ok") return { disponivel: true, encontrado: false, motivo: "nao_encontrado", detalhe: `não localizei "${args.funcionario}" no cadastro do ponto` };
      alvo = r.funcionario;
    }

    if (assunto === "funcionario") {
      if (!alvo) return { disponivel: true, encontrado: false, motivo: "informe o nome do colaborador" };
      return { disponivel: true, encontrado: true, funcionario: { nome: alvo.Nome, matricula: alvo.NumeroFolha, cpf: mascCpf(alvo.Cpf) } };
    }

    const { inicio, fim } = _periodo(args, assunto, deps.now);

    if (assunto === "ponto") {
      if (!alvo) return { disponivel: true, encontrado: false, motivo: "informe o nome do colaborador para consultar o ponto" };
      const batidas = deps.batidas || await skGet("Batidas", { dataInicio: inicio, dataFim: fim });
      const dias = _resumoBatidas(batidas, alvo.Id);
      // A API traz 1 linha por dia do espelho; dia sem marcação vem com entrada/saída vazias.
      // Separar é anti-alucinação: "sem marcação" NÃO é o mesmo que "faltou" (pode ser folga/dia futuro).
      const comMarcacao = dias.filter((d) => d.entrada).length;
      return { disponivel: true, encontrado: true, assunto, funcionario: { nome: alvo.Nome, matricula: alvo.NumeroFolha }, periodo: { inicio, fim }, dias, dias_no_periodo: dias.length, dias_com_marcacao: comMarcacao, dias_sem_marcacao: dias.length - comMarcacao };
    }

    // afastamentos (padrão): com funcionário filtra por CPF; sem, lista o período todo
    const afast = deps.afastamentos || await skGet("FuncionariosAfastamentos", { dataInicio: inicio, dataFim: fim });
    const itens = _resumoAfastamentos(afast, idx, { cpf: alvo?.Cpf });
    return { disponivel: true, encontrado: true, assunto: "afastamentos", periodo: { inicio, fim }, funcionario: alvo ? { nome: alvo.Nome } : null, itens, total: itens.length };
  } catch (e) {
    return { disponivel: true, encontrado: false, motivo: "erro", detalhe: "não consegui consultar o ponto agora" };
  }
}
