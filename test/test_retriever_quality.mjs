// test_retriever_quality.mjs — golden-set de RECALL do retriever de regimentos.
// Cada caso: a melhor resposta para a pergunta do morador deve aparecer no TOP-1 (texto+fonte contém um dos radicais esperados).
// Os radicais foram validados contra os .md reais (a regra existe no documento do condomínio).
// Casos `regress:true` JÁ passavam — guardam contra regressão. Os demais são as melhorias que este lote deve destravar.
import { consultar_regimento } from '../src/regimento.mjs';

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const CASES = [
  // --- guardas de regressão (devem continuar acertando) ---
  { condo: 'Monet', q: 'posso ter cachorro', any: ['anima', 'pet'], regress: true },
  { condo: 'Monet', q: 'quantas vagas de garagem eu tenho', any: ['garage', 'vaga'], regress: true },
  { condo: 'Monet', q: 'posso colocar tela de proteção na janela', any: ['tela'], regress: true },
  { condo: 'Monet', q: 'como faço para reservar o salão de festas', any: ['salao', 'festa'], regress: true },
  { condo: 'Lume', q: 'onde guardo minha bicicleta', any: ['bike', 'bicicl'], regress: true },
  { condo: 'Lume', q: 'qual a multa por jogar lixo no lugar errado', any: ['penalidad', 'multa'], regress: true },
  { condo: 'Lume', q: 'quantas vagas de garagem eu tenho', any: ['garage', 'vaga'], regress: true },
  { condo: 'Casablanca', q: 'posso instalar ar condicionado na fachada', any: ['condicionad', 'exterior', 'fachada'], regress: true },
  { condo: 'Casablanca', q: 'posso usar a churrasqueira do condomínio', any: ['churrasq', 'salao', 'festa'], regress: true },
  { condo: 'Casablanca', q: 'qual a multa por jogar lixo no lugar errado', any: ['penalidad', 'pecuni'], regress: true },
  // --- melhorias-alvo deste lote (hoje FALHAM) ---
  { condo: 'Lume', q: 'posso ter cachorro', any: ['anima', 'pet'], regress: false },        // hoje: ATA polui
  { condo: 'Casablanca', q: 'posso ter cachorro', any: ['anima', 'domestic'], regress: false }, // hoje: "cao" ⊂ "convocacao"
];

let fail = 0, regressFail = 0;
for (const c of CASES) {
  const r = consultar_regimento({ condominio: c.condo, pergunta: c.q, k: 1 });
  const top = r.encontrou ? norm(`${r.trechos[0].fonte} ${r.trechos[0].texto}`) : '';
  const ok = r.encontrou && c.any.some((a) => top.includes(a));
  const detalhe = r.encontrou ? r.trechos[0].fonte : `encontrou:false (${r.motivo})`;
  console.log(`${ok ? 'OK  ' : 'FAIL'} [${c.condo}] ${c.q}  ->  ${detalhe}`);
  if (!ok) { fail++; if (c.regress) regressFail++; }
}
console.log(`\n${CASES.length - fail}/${CASES.length} acertos | regressões: ${regressFail}`);
if (fail) { console.log('TESTE VERMELHO'); process.exit(1); }
console.log('TODOS OS TESTES VERDES');
