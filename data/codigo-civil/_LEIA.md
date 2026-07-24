# Base do Código Civil — Pesquisa 2 (fallback jurídico)

Esta pasta guarda os artigos do **Código Civil (parte de condomínio)** usados como **fallback** quando a
Convenção/Regimento Interno do condomínio **não cobre** a conduta (decisão do Fernando, 23/07/2026 —
"achar conforme a lei"). O verificador de enquadramento é o roteador:

- RI/convenção **governa** a conduta → **Pesquisa 1** (cita o artigo do condomínio). [JÁ NO AR]
- RI/convenção **não** cobre → **Pesquisa 2** (cita o artigo do **Código Civil** desta base). [A LIGAR]
- Nem no CC → humano.

## Formato de ingestão (igual aos regimentos — anti-alucinação, texto VERBATIM da fonte)
- Fonte = **PDF do advogado** (Fernando vai pedir). Converter PDF→Markdown verbatim (OCR só se escaneado).
- 1 arquivo `codigo-civil.md` (ou por tópico `cc-<topico>.md`), cada artigo numa seção com o **texto literal**:
  ```
  ## Art. 1.336 — Deveres do condômino
  <texto literal do artigo, verbatim>
  ```
- O LLM só **classifica o tópico**; o texto do artigo vem daqui (nunca da cabeça do modelo).

## Estado (24/07/2026)
- ✅ **Base ingerida:** `codigo-civil.md` (45 artigos, 1.314–1.358, verbatim do PDF do advogado que o Fernando mandou).
- ✅ **Etapa 1 — consulta LIVE:** tool `consultar_codigo_civil(tema)` (`src/codigo_civil.mjs`) registrada no Estagiário;
  o prompt já faz as 2 camadas (RI/convenção → se não cobre, Código Civil). `test/test_codigo_civil.mjs` 15/15.
- ⏳ **Etapa 2 — GERAÇÃO de notificação com base no CC (pendente):** rotear no `gerar_documento` (o verificador
  incompatível no RI → busca CC → gera citando o artigo do CC no cabeçalho). Plano: `proposta/prompt-sessao-pesquisa2-codigo-civil.md`.
  Até lá, gerar documento com base no RI segue como está (o verificador barra o que não casa).
