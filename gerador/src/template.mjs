// Layout do documento (Notificação / Multa) — fiel aos modelos do Condomínio Vancouver.
// Recebe um objeto `doc` JÁ montado pelo gerar.mjs (artigo, valores e blocos já resolvidos).
// Este arquivo NÃO contém lógica de negócio nem IA — só apresentação.
//
// Cabeçalho/rodapé repetidos em CADA página via <thead>/<tfoot> de tabela — método estável
// no print do Chromium (position:fixed é inconsistente).

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function par(s) {
  return esc(s).replace(/\n/g, "<br>");
}

export function renderHTML(doc) {
  const c = doc.condominio;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<style>
  @page { size: A4; margin: 1.6cm 2.0cm 1.4cm 2.0cm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Times New Roman", Georgia, serif;
    font-size: 12pt; line-height: 1.42; color: #111;
  }
  table.doc { width: 100%; border-collapse: collapse; }
  /* thead repete no topo de cada página impressa; tfoot no rodapé */
  thead .cabecalho { text-align: center; padding-bottom: 8px; border-bottom: 1px solid #444; }
  thead .condo-nome { font-weight: bold; font-size: 12.5pt; letter-spacing: .3px; }
  thead .condo-end  { font-size: 8.5pt; margin-top: 2px; }
  thead td { padding-bottom: 14px; }
  tfoot td { padding-top: 6px; }
  tfoot .rodape-ia { text-align: center; font-size: 7.5pt; color: #999; border-top: 1px solid #ddd; padding-top: 4px; }

  .conteudo { text-align: justify; }
  .titulo {
    text-align: center; font-weight: bold; text-transform: uppercase;
    margin: 2px 0 16px; font-size: 12.5pt; line-height: 1.3;
  }
  .saudacao { margin: 0 0 12px; }
  .fundamento { margin: 0 0 7px; }
  .artigo { margin: 0 0 13px; padding-left: 1.2cm; font-style: italic; }
  .corpo { margin: 0 0 12px; }
  .penalidade { margin: 0 0 13px; }
  .convencao-titulo { font-weight: bold; text-align: center; margin: 14px 0 7px; font-size: 11pt; }
  .convencao { font-size: 10pt; line-height: 1.38; }
  .fecho-bloco { page-break-inside: avoid; }
  .fecho { margin: 18px 0 4px; }
  .local-data { margin: 4px 0 26px; }
  .assinatura { text-align: center; margin-top: 16px; page-break-inside: avoid; }
  .assinatura .nome { font-weight: bold; text-transform: uppercase; border-top: 1px solid #111; padding-top: 4px; display: inline-block; min-width: 7cm; }
  .assinatura .cargo { text-transform: uppercase; font-size: 11pt; }
</style>
</head>
<body>
<table class="doc">
  <thead>
    <tr><td>
      <div class="cabecalho">
        <div class="condo-nome">${esc(c.nome)}</div>
        <div class="condo-end">${esc(c.endereco)} &nbsp; CEP ${esc(c.cep)} &nbsp; ${esc(c.cidade_uf)}</div>
      </div>
    </td></tr>
  </thead>
  ${doc.marca_dagua ? `<tfoot><tr><td><div class="rodape-ia">${esc(doc.marca_dagua)}</div></td></tr></tfoot>` : ""}
  <tbody>
    <tr><td>
      <div class="conteudo">
        <div class="titulo">${par(doc.titulo)}</div>
        <div class="saudacao">${esc(doc.saudacao)}</div>
        <div class="fundamento">${esc(doc.fundamento)}</div>
        <div class="artigo">${par(doc.texto_artigo)}</div>
        <div class="corpo">${par(doc.relato)}</div>
        ${doc.penalidade_paragrafo ? `<div class="penalidade">${par(doc.penalidade_paragrafo)}</div>` : ""}
        <div class="convencao-titulo">${esc(doc.convencao.capitulo)}</div>
        <div class="convencao">${par(doc.convencao.texto)}</div>
        <div class="fecho-bloco">
          <div class="fecho">${esc(doc.fecho)}</div>
          <div class="local-data">${esc(doc.local_data)}</div>
          <div class="assinatura">
            <div class="nome">${esc(doc.assinatura.nome)}</div>
            <div class="cargo">${esc(doc.assinatura.cargo)}</div>
          </div>
        </div>
      </div>
    </td></tr>
  </tbody>
</table>
</body>
</html>`;
}
