// server.mjs — Chat NCS (assistente interno): porta SEPARADA da Ana, com código próprio, + download do PDF.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.mjs";   // REUSO: mesma leitura de env
import { getSession, saveSession } from "../src/memory.mjs"; // REUSO: sessão persistente
import { handleTurn } from "./src/agent.mjs";
import { SAIDA } from "./src/documentos.mjs";
import { descreverAnexo, montarMensagemComAnexo } from "./src/visao.mjs"; // Fase 2: anexos (foto/print/PDF)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHAT_HTML = fs.readFileSync(path.join(__dirname, "public", "chat.html"), "utf8");
const PORT = parseInt(process.env.PORT || "8090", 10);

function readBody(req) { return new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d)); }); }
function json(res, code, obj) { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); }

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true, service: "chat-ncs", model: config.agentModel });

    // download da minuta/relatório gerado (PDF inline ou Word para baixar/editar)
    if (req.method === "GET" && req.url.startsWith("/doc/")) {
      const name = path.basename(decodeURIComponent(req.url.slice(5).split("?")[0]));
      const fp = path.join(SAIDA, name);
      const isDoc = name.endsWith(".doc");
      if ((!name.endsWith(".pdf") && !isDoc) || !fs.existsSync(fp)) return json(res, 404, { erro: "não encontrado" });
      const ct = isDoc ? "application/msword" : "application/pdf";
      const disp = isDoc ? "attachment" : "inline"; // .doc: baixa para abrir editável no Word
      res.writeHead(200, { "Content-Type": ct, "Content-Disposition": `${disp}; filename="${name}"` });
      return res.end(fs.readFileSync(fp));
    }

    if (req.method === "GET" && (req.url === "/" || (req.url.startsWith("/chat") && !req.url.startsWith("/chat-send")))) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(CHAT_HTML);
    }

    if (req.method === "POST" && req.url.startsWith("/chat-send")) {
      const data = JSON.parse((await readBody(req)) || "{}");
      if (config.chatPasscode && data.k !== config.chatPasscode) return json(res, 401, { reply: "código inválido" });
      const estagKey = "estag-" + (data.session || "anon");
      const session = await getSession(estagKey);
      let msg = data.message || "";
      // Fase 2 (multimodal): se veio um anexo (foto da ocorrência / print / PDF), o Gemini lê o
      // conteúdo e a descrição entra como texto no loop (que é text-only). Anti-alucinação: base factual.
      if (data.anexo && typeof data.anexo === "string" && data.anexo.startsWith("data:")) {
        const vis = await descreverAnexo(data.anexo);
        msg = montarMensagemComAnexo(msg, vis);
      }
      const r = await handleTurn(session, msg, {});
      await saveSession(estagKey, session);
      return json(res, 200, { reply: r.reply, doc: r.doc || null });
    }

    return json(res, 404, { erro: "not found" });
  } catch (e) {
    console.error("[chat-ncs] erro:", e.message);
    return json(res, 200, { reply: "Tive um problema aqui. Pode tentar de novo?", erro: true });
  }
});
server.listen(PORT, () => console.log(`[chat-ncs] ouvindo :${PORT} | modelo ${config.agentModel} | chat=${config.chatPasscode ? "on" : "off"}`));
