// Renderiza um HTML em PDF usando Chrome/Edge headless (sem libs externas).
// Receita do CLAUDE.md global: gera em pasta temp SEM acento/espaço e copia p/ destino.
// Robustez: tenta cada navegador disponível e usa o primeiro que produzir o PDF.
// (Edge, quando o navegador do usuário está aberto, "encaminha" a chamada e não gera nada —
//  por isso tentamos Chrome primeiro e validamos a saída de cada tentativa.)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function navegadoresDisponiveis() {
  const pf = process.env["ProgramFiles"] || "C:\\Program Files";
  const pfx = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const candidatos = [
    process.env.CHROME_PATH || process.env.CHROMIUM_PATH, // override explícito (container)
    // Linux (container Alpine/Debian)
    "/usr/bin/chromium-browser", "/usr/bin/chromium",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
    // Windows (dev local)
    path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(pfx, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(pfx, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
  ].filter(Boolean);
  const achados = candidatos.filter((c) => { try { return fs.existsSync(c); } catch { return false; } });
  if (!achados.length) throw new Error("Chrome/Chromium/Edge não encontrado (defina CHROME_PATH ou instale o navegador).");
  return achados;
}

export function htmlParaPdf(html, destinoPdf) {
  const navegadores = navegadoresDisponiveis();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ncs-doc-")); // temp sem acento/espaço
  const htmlPath = path.join(tmp, "doc.html");
  fs.writeFileSync(htmlPath, html, "utf-8");
  const uri = "file:///" + htmlPath.replace(/\\/g, "/");

  let ok = false, ultimoErro = null;
  for (let i = 0; i < navegadores.length && !ok; i++) {
    const pdfTmp = path.join(tmp, `doc-${i}.pdf`);
    const args = [
      "--headless=new", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer",
      "--no-first-run", "--no-default-browser-check", "--disable-extensions",
      "--run-all-compositor-stages-before-draw", "--virtual-time-budget=8000",
      `--user-data-dir=${path.join(tmp, "ud-" + i)}`,
      `--print-to-pdf=${pdfTmp}`, uri,
    ];
    try {
      execFileSync(navegadores[i], args, { stdio: "ignore", timeout: 60000 });
    } catch (e) { ultimoErro = e; }
    if (fs.existsSync(pdfTmp) && fs.statSync(pdfTmp).size > 0) {
      fs.mkdirSync(path.dirname(destinoPdf), { recursive: true });
      fs.copyFileSync(pdfTmp, destinoPdf);
      ok = true;
    }
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  if (!ok) throw new Error("Nenhum navegador gerou o PDF." + (ultimoErro ? " Último erro: " + ultimoErro.message : ""));
  return destinoPdf;
}
