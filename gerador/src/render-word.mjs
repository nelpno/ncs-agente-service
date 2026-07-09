// render-word.mjs — envolve um HTML COMPLETO para o Word abrir como DOCUMENTO editável (.doc),
// sem dependência nova (o Word lê HTML + marcadores MSO). Usado por notificações/multas e relatórios.
// ⚠️ Gráficos SVG/imagens complexas podem não renderizar no Word; texto e tabelas sim — o valor
// editável (apagar artigo que não se aplica, complementar o relato) está no texto.
export function htmlParaWord(html) {
  const mso = `<meta name=ProgId content=Word.Document><meta name=Originator content="Microsoft Word 15">` +
    `<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + mso);
  if (/<html[^>]*>/i.test(html)) return html.replace(/(<html[^>]*>)/i, `$1<head>${mso}</head>`);
  return `<html><head>${mso}</head><body>${html}</body></html>`;
}
