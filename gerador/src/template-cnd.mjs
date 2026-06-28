// template-cnd.mjs — HTML da Declaração de Quitação de Débitos (CND).
// Texto VERBATIM do modelo do Fernando (25/06/2026, cnd-modelo-fernando.md).
// NÃO contém lógica de negócio nem IA — só apresentação.
// Mesma convenção de template.mjs: cabeçalho via <thead> que repete em cada página.
//
// Dois tipos (decisão Fernando/Nelson 26/06):
//   - 'oficial'      → via para o síndico assinar (Autentique). Linha de assinatura.
//   - 'informativo'  → entregue direto a quem NÃO precisa de assinatura. Carrega aviso
//                      claro de que NÃO é a via oficial assinada (salvaguarda jurídica).

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * renderDeclaracaoHTML(dados) → string HTML pronto para htmlParaPdf().
 *
 * dados = {
 *   condominio: { nome, endereco, cidade_uf },  // anti-alucinação: tudo do Superlógica
 *   unidade:     string,                         // identificação da unidade (ex: "Bloco A / Apto 12")
 *   dataPosicao: string,                         // ex: "26 de junho de 2026"
 *   tipo:        'oficial' | 'informativo',      // padrão: 'oficial'
 * }
 */
export function renderDeclaracaoHTML(dados) {
  const { condominio, unidade, dataPosicao, tipo = "oficial" } = dados;
  const informativo = tipo === "informativo";

  const selo = informativo
    ? `<div class="selo-info">VIA INFORMATIVA &mdash; sem assinatura. Documento de confer&ecirc;ncia; a via oficial &eacute; assinada pelo s&iacute;ndico.</div>`
    : "";

  const blocoAssinatura = informativo
    ? `<div class="assinatura-bloco">
          <div class="aviso-sem-assinatura">
            Documento gerado eletronicamente, <b>sem assinatura</b>. N&atilde;o substitui a Declara&ccedil;&atilde;o de Quita&ccedil;&atilde;o
            oficial assinada pelo s&iacute;ndico (Lei 12.007/09). Para a via oficial assinada, solicite ao s&iacute;ndico/financeiro.
          </div>
        </div>`
    : `<div class="assinatura-bloco">
          <div class="assinatura-linha">S&iacute;ndico(a)</div>
        </div>`;

  const rodape = informativo
    ? `Documento INFORMATIVO gerado por assistente NCS em ${esc(dataPosicao)} &mdash; n&atilde;o substitui a via oficial assinada pelo s&iacute;ndico.`
    : `Rascunho gerado por assistente NCS em ${esc(dataPosicao)} &mdash; conferir e assinar via Autentique (s&iacute;ndico respons&aacute;vel).`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<style>
  @page { size: A4; margin: 2.0cm 2.5cm 2.0cm 2.5cm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Times New Roman", Georgia, serif;
    font-size: 12pt; line-height: 1.5; color: #111;
  }
  table.doc { width: 100%; border-collapse: collapse; }
  thead .cabecalho { text-align: center; padding-bottom: 10px; border-bottom: 2px solid #333; }
  thead .condo-nome { font-weight: bold; font-size: 13pt; letter-spacing: .3px; text-transform: uppercase; }
  thead .condo-end  { font-size: 9pt; margin-top: 3px; color: #444; }
  thead td { padding-bottom: 20px; }
  tfoot td { padding-top: 8px; }
  tfoot .rodape-ia {
    text-align: center; font-size: 7pt; color: #aaa;
    border-top: 1px solid #ddd; padding-top: 4px;
  }

  .selo-info {
    text-align: center; font-size: 9pt; font-weight: bold; color: #8a5a00;
    background: #fff6e0; border: 1px solid #e0b450; border-radius: 4px;
    padding: 6px 10px; margin: 6px 0 0;
  }

  .conteudo { text-align: justify; }
  .titulo {
    text-align: center; font-weight: bold; text-transform: uppercase;
    margin: 30px 0 6px; font-size: 13pt; letter-spacing: .5px;
  }
  .subtitulo {
    text-align: center; font-size: 10.5pt; color: #333; margin-bottom: 30px;
  }
  .corpo { margin: 0 0 14px; text-indent: 1.5cm; }
  .fecho { margin: 28px 0 4px; }
  .assinante { font-weight: bold; }
  .departamento { color: #333; }

  .anuencia-titulo {
    font-weight: bold; text-transform: uppercase; margin: 36px 0 10px;
    border-top: 1px solid #999; padding-top: 14px; font-size: 10.5pt;
  }
  .anuencia-linha { margin: 2px 0; font-size: 10.5pt; }

  .assinatura-bloco {
    margin-top: 50px; text-align: center; page-break-inside: avoid;
  }
  .assinatura-linha {
    display: inline-block; min-width: 8cm;
    border-top: 1px solid #111; padding-top: 4px;
    font-size: 10pt; text-align: center;
  }
  .aviso-sem-assinatura {
    font-size: 9pt; color: #666; font-style: italic;
    border: 1px dashed #bbb; border-radius: 4px; padding: 10px 12px;
    max-width: 13cm; margin: 0 auto; text-align: center; line-height: 1.4;
  }
</style>
</head>
<body>
<table class="doc">
  <thead>
    <tr><td>
      <div class="cabecalho">
        <div class="condo-nome">${esc(condominio.nome)}</div>
        <div class="condo-end">${esc(condominio.endereco)}</div>
      </div>
      ${selo}
    </td></tr>
  </thead>
  <tfoot>
    <tr><td>
      <div class="rodape-ia">${rodape}</div>
    </td></tr>
  </tfoot>
  <tbody>
    <tr><td>
      <div class="conteudo">

        <div class="titulo">Declaração de Quitação de Débitos</div>
        <div class="subtitulo">Posição ${esc(dataPosicao)}; Unidade ${esc(unidade)}</div>

        <p class="corpo">
          Na condição de administradora deste empreendimento denominado ${esc(condominio.nome)},
          na pessoa do seu representante contábil, declara que todas as pendências até o dia ${esc(dataPosicao)} da
          unidade ${esc(unidade)}, para os devidos fins de direito, em cumprimento da Lei 12007/09, junto a
          esse empreendimento, foram quitadas.
        </p>

        <p class="corpo">Por ser verdade firmo a presente,</p>

        <p class="corpo assinante">GRUPO NCS</p>
        <p class="corpo departamento">Depto. Financeiro</p>

        <div class="anuencia-titulo">Anuência</div>
        <div class="anuencia-linha">${esc(condominio.nome)}</div>
        <div class="anuencia-linha">${esc(condominio.endereco)}</div>
        <div class="anuencia-linha">${esc(condominio.cidade_uf)}</div>

        ${blocoAssinatura}

      </div>
    </td></tr>
  </tbody>
</table>
</body>
</html>`;
}
