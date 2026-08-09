# ocr_imagens_ata.py — recupera o conteúdo que a ata carrega em IMAGEM (tabela de rateio, diagrama).
#
# Por que existe: a ata do Lume 19/03/2026 traz a tabela de rateio (Calhas R$ 8.800 … Total
# R$ 40.940,00, com o valor por apartamento em 3/9/10 parcelas) como PNG embutido. Nem o
# read_file_content do Drive, nem fitz.get_text(), nem pdfplumber.extract_tables() recuperam nada
# disso — os três leem a camada de TEXTO, e ali não há texto nenhum, só pixels. O texto extraído
# salta de "foram aprovados os seguintes valores:" direto para "Após a análise dos valores", e o
# resultado continua parecendo uma ata completa. É perda silenciosa de exatamente o dado que o
# síndico pergunta.
#
# 🔴 O gate NÃO pode ser a heurística usual de "poucos caracteres por página = escaneado": esta ata
# tem 26.348 caracteres e seria classificada como "não precisa OCR", pulando justo a página da
# tabela. O gate é POR PÁGINA COM IMAGEM GRANDE.
#
#   listar : PYTHONIOENCODING=utf-8 python scripts/ocr_imagens_ata.py <arquivo.pdf>
#   ocr    : PYTHONIOENCODING=utf-8 GEMINI_KEY_FILE=.tmp/gemini_key.txt python scripts/ocr_imagens_ata.py <arquivo.pdf> --ocr
import base64
import json
import os
import sys
import urllib.request

import fitz

# O logo do condomínio se repete em toda página (297x65 no Lume). O piso descarta logo/assinatura
# digitalizada e mantém tabela e diagrama, que são o que carrega informação.
MIN_W, MIN_H = 300, 100
MODELO = "gemini-2.5-flash"

PROMPT = (
    "Esta imagem foi recortada de uma ata de assembleia de condomínio. "
    "Transcreva TODO o conteúdo dela em Markdown. "
    "Se for uma tabela, use uma tabela Markdown preservando cabeçalhos, todas as linhas e todos os "
    "valores exatamente como aparecem (inclusive R$, pontos e vírgulas). "
    "Se for um diagrama ou figura, descreva objetivamente a informação que ele carrega. "
    "Não resuma, não arredonde e não acrescente nada que não esteja na imagem. "
    "Responda só com o conteúdo, sem introdução."
)


def imagens_de_conteudo(pdf_path):
    """Devolve [(pagina_1based, xref, largura, altura)] das imagens acima do piso."""
    doc = fitz.open(pdf_path)
    achados = []
    for i, page in enumerate(doc):
        for img in page.get_images(full=True):
            xref, w, h = img[0], img[2], img[3]
            if w > MIN_W and h > MIN_H:
                achados.append((i + 1, xref, w, h))
    doc.close()
    return achados


def extrair_png(pdf_path, xref):
    doc = fitz.open(pdf_path)
    try:
        info = doc.extract_image(xref)
        return info["image"], info["ext"]
    finally:
        doc.close()


def ocr_gemini(img_bytes, ext, chave):
    mime = "image/png" if ext == "png" else f"image/{ext}"
    corpo = {
        "contents": [{"parts": [
            {"text": PROMPT},
            {"inline_data": {"mime_type": mime, "data": base64.b64encode(img_bytes).decode()}},
        ]}],
        # temperatura 0: transcrição é cópia, não redação — variar aqui só inventa número
        "generationConfig": {"temperature": 0},
    }
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODELO}:generateContent?key={chave}"
    req = urllib.request.Request(url, data=json.dumps(corpo).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        resp = json.loads(r.read())
    try:
        return resp["candidates"][0]["content"]["parts"][0]["text"].strip()
    except (KeyError, IndexError):
        raise RuntimeError(f"resposta inesperada do Gemini: {json.dumps(resp)[:300]}")


def _num(s):
    """'R$ 8.800,00' -> 8800.0 ; devolve None se não for número."""
    import re
    m = re.fullmatch(r"R?\$?\s*([\d.]+,\d{2}|\d+)", s.strip())
    if not m:
        return None
    try:
        return float(m.group(1).replace(".", "").replace(",", "."))
    except ValueError:
        return None


def conferir_tabela(md, texto_do_pdf):
    """Dois controles INDEPENDENTES do OCR, porque dígito lido de imagem não se aceita sozinho.

    1) ARITMÉTICO: se houver linha de total, ela tem de bater com a soma da coluna.
    2) CRUZAMENTO: os valores da tabela costumam aparecer soltos no texto corrido da ata (cada
       orçamento é discutido item a item antes de virar tabela) — se nenhum aparecer, desconfie.
    Devolve lista de avisos (vazia = nada a apontar).
    """
    import re
    avisos = []
    linhas = [l for l in md.splitlines() if l.strip().startswith("|") and "---" not in l]
    if not linhas:
        return ["não parece tabela — nada a conferir aritmeticamente"]

    # ⚠️ Só a célula com "R$" conta. Usar "o primeiro número da linha" fazia o cabeçalho
    # "| Por apto | 3 | 9 | 10 |" entrar na soma como 3 e o total nunca fechar.
    # ⚠️ E o plural de "total" é "TOTAIS": procurar "total" não casa a linha de fecho da tabela,
    # e o guard passava a vida inteira dizendo "sem linha de total" com ela na tela.
    col, total = [], None
    for l in linhas:
        celulas = [c.strip() for c in l.strip().strip("|").split("|")]
        monetarias = [_num(c) for c in celulas if "R$" in c]
        monetarias = [v for v in monetarias if v is not None]
        if not monetarias:
            continue
        if re.search(r"\btota(?:l|is)\b", l, re.I):
            total = monetarias[0]
        else:
            col.append(monetarias[0])

    if total is not None and col:
        soma = sum(col)
        if abs(soma - total) > 0.02:
            avisos.append(f"SOMA NÃO FECHA: itens somam {soma:.2f} e a linha de total diz {total:.2f}")
    elif total is None:
        avisos.append("sem linha de total — não deu para conferir a soma")

    achados = [v for v in col if v and f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".") in texto_do_pdf]
    if col and not achados:
        avisos.append("nenhum valor da tabela aparece no texto corrido da ata — conferir a olho")
    return avisos


def autoteste():
    """Os dois lados do guard aritmético. Guard que nunca dispara é ruído; guard que dispara
    sempre reprova trabalho correto. `python scripts/ocr_imagens_ata.py --autoteste`"""
    txt = "orcamento de 8.800,00 e de 13.500,00 apresentados aos presentes"
    boa = "| Calhas | R$ 8.800,00 | 73,33 |\n| Cobertura | R$ 13.500,00 | 112,50 |\n| Totais | R$ 22.300,00 | 185,83 |"
    ruim = boa.replace("22.300,00", "28.300,00")
    # cabeçalho de parcelamento não pode entrar na soma (era o bug: "3" virava R$ 3,00)
    com_cabecalho = "| | Por apto | 3 | 9 | 10 |\n" + boa
    casos = [
        ("tabela correta não gera aviso", conferir_tabela(boa, txt) == []),
        ("total adulterado é pego", any("NÃO FECHA" in a for a in conferir_tabela(ruim, txt))),
        ("cabeçalho de parcelamento não entra na soma", conferir_tabela(com_cabecalho, txt) == []),
        ("'Totais' (plural) é reconhecido como linha de total",
         not any("sem linha de total" in a for a in conferir_tabela(boa, txt))),
    ]
    falhas = 0
    for nome, ok in casos:
        print(f"{'OK ' if ok else 'FALHA'} {nome}")
        falhas += 0 if ok else 1
    print("TODOS VERDES" if not falhas else f"{falhas} FALHA(S)")
    return 1 if falhas else 0


def main():
    if "--autoteste" in sys.argv:
        return autoteste()
    if len(sys.argv) < 2:
        print("uso: python scripts/ocr_imagens_ata.py <arquivo.pdf> [--ocr] | --autoteste")
        return 1
    pdf = sys.argv[1]
    fazer_ocr = "--ocr" in sys.argv
    achados = imagens_de_conteudo(pdf)

    print(f"{os.path.basename(pdf)}: {len(achados)} imagem(ns) de conteúdo (piso {MIN_W}x{MIN_H})")
    for pag, xref, w, h in achados:
        print(f"  página {pag:>2}  xref={xref:<5} {w}x{h}")
    if not achados:
        print("Nada em imagem — o texto extraído já é a ata inteira.")
        return 0
    if not fazer_ocr:
        print("\n(--ocr para transcrever)")
        return 0

    caminho_chave = os.environ.get("GEMINI_KEY_FILE", ".tmp/gemini_key.txt")
    with open(caminho_chave, encoding="utf-8") as f:
        chave = f.read().strip()

    doc = fitz.open(pdf)
    texto_corrido = "".join(p.get_text() for p in doc)
    doc.close()

    problemas = 0
    for pag, xref, w, h in achados:
        img, ext = extrair_png(pdf, xref)
        texto = ocr_gemini(img, ext, chave)
        print(f"\n===== PÁGINA {pag} (imagem {w}x{h}) =====")
        print(texto)
        for a in conferir_tabela(texto, texto_corrido):
            print(f"  ⚠️  {a}")
            if "NÃO FECHA" in a:
                problemas += 1
    if problemas:
        print(f"\n{problemas} tabela(s) com soma inconsistente — revisar antes de ingerir.")
    return 1 if problemas else 0


if __name__ == "__main__":
    sys.exit(main())
