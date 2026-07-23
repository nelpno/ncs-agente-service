// campos_condo.mjs — campos obrigatórios EXTRA por condomínio (Fernando 22/07). Mapa é DADO, não código:
// condomínio sem extras sai byte-idêntico; o próximo condo com exigência própria é 1 linha de JS.
// Keyed por id_condominio (string). `payload` = chave de escrita no Superlógica; `payload:null` = NÃO vai
// ao ERP (fica no card do aprovador + aviso à portaria, que é quem consome placa de verdade).
//
// ⚠️ `DT_NASCIMENTO_CON` existe na doc da API; a ESCRITA via `unidades/post` é RAIO-X PENDENTE (provável,
// confirmar no eco do DRY / teste controlado — mesmo método do DT_SAIDA_RES). Veículo/placa NÃO têm campo
// no Superlógica (zero hits na doc) → só card + portaria.
export const CAMPOS_EXTRA_POR_CONDO = {
  '164': [ // Associação Tivoli (Fernando 22/07: "acrescentar data de nascimento, modelo e placa do veículo")
    { campo: 'data_nascimento', label: 'data de nascimento', payload: 'contatos[0][DT_NASCIMENTO_CON]' },
    { campo: 'veiculo_modelo', label: 'modelo do veículo', payload: null }, // sem campo no ERP → card + portaria
    { campo: 'veiculo_placa', label: 'placa do veículo', payload: null },
  ],
};

export function camposExtra(idCondominio) {
  return CAMPOS_EXTRA_POR_CONDO[String(idCondominio ?? '')] || [];
}

// Erros nomeados dos extras que faltam — o `validar` concatena; o texto guia a Ana a PEDIR (não trava no
// schema, senão o LLM inventaria). Vazio quando o condomínio não tem exigência extra (byte-idêntico).
export function validarExtras(idCondominio, dados) {
  return camposExtra(idCondominio)
    .filter((c) => !dados?.[c.campo])
    .map((c) => `faltou ${c.label} (obrigatório neste condomínio)`);
}

// Só os extras que VÃO ao ERP (payload != null), montados p/ o payload do unidades/post.
export function payloadExtras(idCondominio, dados) {
  const p = {};
  for (const c of camposExtra(idCondominio)) if (c.payload && dados?.[c.campo]) p[c.payload] = dados[c.campo];
  return p;
}
