// CLI fino sobre gerar-lib.mjs.
//   node src/gerar.mjs exemplos/barulho-multa-2a.json [saida/meu-doc.pdf]
import fs from "node:fs";
import path from "node:path";
import { gerarDocumento, RAIZ } from "./gerar-lib.mjs";

const entradaArg = process.argv[2];
if (!entradaArg) { console.error("ERRO: informe o JSON da ocorrência. Ex: node src/gerar.mjs exemplos/lavar-veiculo-notif.json"); process.exit(1); }

try {
  const ocPath = path.isAbsolute(entradaArg) ? entradaArg : path.join(RAIZ, entradaArg);
  const ocorrencia = JSON.parse(fs.readFileSync(ocPath, "utf-8"));
  const saidaArg = process.argv[3];
  const destino = saidaArg ? (path.isAbsolute(saidaArg) ? saidaArg : path.join(RAIZ, saidaArg)) : undefined;
  const { destino: out, titulo } = gerarDocumento({ ocorrencia, destino });
  console.log("PDF gerado: " + out);
  console.log(`  ${titulo} · ${ocorrencia.destinatario.nome} · ap ${ocorrencia.destinatario.apartamento}`);
} catch (e) {
  console.error("ERRO: " + e.message);
  if (e.infracoes_disponiveis) console.error("  infrações disponíveis: " + e.infracoes_disponiveis.join(", "));
  process.exit(1);
}
