// server.mjs — Chat NCS (assistente interno): porta SEPARADA da Ana, com código próprio, + download do PDF.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.mjs";   // REUSO: mesma leitura de env
import { getSession } from "../src/memory.mjs"; // REUSO: sessão in-memory
import { handleTurn } from "./src/agent.mjs";
import { SAIDA } from "./src/documentos.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHAT_HTML = fs.readFileSync(path.join(__dirname, "public", "chat.html"), "utf8");
const PORT = parseInt(process.env.PORT || "8090", 10);

function readBody(req) { return new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d)); }); }
function json(res, code, obj) { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); }

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true, service: "chat-ncs", model: config.agentModel });

    // download da minuta gerada
    if (req.method === "GET" && req.url.startsWith("/doc/")) {
      const name = path.basename(decodeURIComponent(req.url.slice(5).split("?")[0]));
      const fp = path.join(SAIDA, name);
      if (!name.endsWith(".pdf") || !fs.existsSync(fp)) return json(res, 404, { erro: "não encontrado" });
      res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}"` });
      return res.end(fs.readFileSync(fp));
    }

    if (req.method === "GET" && (req.url === "/" || (req.url.startsWith("/chat") && !req.url.startsWith("/chat-send")))) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(CHAT_HTML);
    }

    if (req.method === "POST" && req.url.startsWith("/chat-send")) {
      const data = JSON.parse((await readBody(req)) || "{}");
      if (config.chatPasscode && data.k !== config.chatPasscode) return json(res, 401, { reply: "código inválido" });
      const session = getSession("estag-" + (data.session || "anon"));
      const r = await handleTurn(session, data.message || "", {});
      return json(res, 200, { reply: r.reply, doc: r.doc || null });
    }

    return json(res, 404, { erro: "not found" });
  } catch (e) {
    console.error("[chat-ncs] erro:", e.message);
    return json(res, 200, { reply: "Tive um problema aqui. Pode tentar de novo?", erro: true });
  }
});
server.listen(PORT, () => console.log(`[chat-ncs] ouvindo :${PORT} | modelo ${config.agentModel} | chat=${config.chatPasscode ? "on" : "off"}`));
