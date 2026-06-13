// Teste do retriever de regimento (sem LLM): valida que as seções certas sobem para cada pergunta.
import { consultar_regimento } from '../src/regimento.mjs';

const casos = [
  { q: 'Posso ter cachorro no apartamento?', espera: /animais|pet/i },
  { q: 'Qual o horario permitido pra fazer mudanca?', espera: /mudan/i },
  { q: 'Posso fechar minha varanda com vidro?', espera: /varanda|fechamento/i },
  { q: 'Ate que horas posso usar a piscina?', espera: /piscina/i },
  { q: 'Como reservar o espaco gourmet pro fim de semana?', espera: /gourmet|festas|festa/i },
  { q: 'Morador lavando carro na garagem, pode?', espera: /garagem|veiculo|deveres/i },
  { q: 'Excesso de barulho a noite, qual a regra?', espera: /deveres|silencio|penalidade|disposi/i },
  { q: 'Tem regra pro lixo?', espera: /lixo/i },
  { q: 'O condominio tem convenio com academia externa?', espera: null }, // deve achar pouco/nada relevante
];

let ok = 0;
for (const { q, espera, } of casos) {
  const r = consultar_regimento({ condominio: 'lume', pergunta: q });
  const fontes = (r.trechos || []).map((t) => t.fonte);
  const top = fontes[0] || '(nenhum)';
  const acerto = espera ? fontes.some((f) => espera.test(f)) : true;
  if (acerto) ok++;
  console.log(`${acerto ? 'OK ' : 'XX '} "${q}"`);
  console.log(`     encontrou=${r.encontrou} | top: ${top}`);
  if (espera && !acerto) console.log(`     >>> esperava casar ${espera} em: ${fontes.join(' | ')}`);
}
console.log(`\n${ok}/${casos.length} recuperações no alvo`);

// isolamento / comportamento de "só responde do que tiver"
console.log('\n--- isolamento & disponibilidade ---');
const fora = consultar_regimento({ condominio: 'Jardim das Acacias', pergunta: 'posso ter cachorro?' });
console.log(`condo fora da base -> encontrou=${fora.encontrou} motivo=${fora.motivo} (esperado: false / condominio_sem_regimento)`);
const semCondo = consultar_regimento({ pergunta: 'posso ter cachorro?' });
console.log(`sem condomínio    -> encontrou=${semCondo.encontrou} motivo=${semCondo.motivo} (esperado: false / condominio_nao_informado — NÃO assume Lume)`);
const okLume = consultar_regimento({ condominio: 'Lume', pergunta: 'cachorro' });
console.log(`Lume (na base)    -> encontrou=${okLume.encontrou} top=${okLume.trechos?.[0]?.fonte}`);
