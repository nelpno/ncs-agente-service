// test_cobranca_regua.mjs — régua de cobrança pós-30d (Fernando 18/07): 3 tentativas por e-mail nos dias
// +33, +43, +60 de atraso (3/13/30 dias após o 30º). 1 por vez; esgotada após a 3ª → extrajudicial.
// Determinístico. A decisão é "dado o atraso e quantas tentativas já foram feitas (do CRM), envio hoje?".
import { tentativaDaRegua, MARCOS_REGUA } from '../src/cobranca/regua.mjs';

let falhas = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK ' : 'FALHA'} ${msg}`); if (!cond) falhas++; };

// marcos padrão = 33/43/60
ok(Array.isArray(MARCOS_REGUA) && MARCOS_REGUA.join(',') === '33,43,60', `MARCOS_REGUA = 33,43,60 (${MARCOS_REGUA})`);

// 1) antes do 1º marco (atraso 20, nenhuma tentativa) → não envia
{ const r = tentativaDaRegua({ diasAtraso: 20, tentativasFeitas: 0 });
  ok(r.enviar === false && r.motivo === 'aguardando', `atraso 20, 0 feitas -> não envia/aguardando (${r.enviar}/${r.motivo})`); }

// 2) no 1º marco (33, 0 feitas) → envia etapa 1
{ const r = tentativaDaRegua({ diasAtraso: 33, tentativasFeitas: 0 });
  ok(r.enviar === true && r.etapa === 1 && r.marcoDias === 33, `atraso 33, 0 feitas -> envia etapa 1 (${r.enviar}/${r.etapa}/${r.marcoDias})`); }

// 3) entre marcos (40, 1 feita) → aguarda o 2º marco (43)
{ const r = tentativaDaRegua({ diasAtraso: 40, tentativasFeitas: 1 });
  ok(r.enviar === false && r.motivo === 'aguardando', `atraso 40, 1 feita -> aguardando (marco 43 não atingido) (${r.enviar}/${r.motivo})`); }

// 4) no 2º marco (43, 1 feita) → envia etapa 2
{ const r = tentativaDaRegua({ diasAtraso: 43, tentativasFeitas: 1 });
  ok(r.enviar === true && r.etapa === 2 && r.marcoDias === 43, `atraso 43, 1 feita -> envia etapa 2 (${r.enviar}/${r.etapa})`); }

// 5) no 3º marco (60, 2 feitas) → envia etapa 3
{ const r = tentativaDaRegua({ diasAtraso: 60, tentativasFeitas: 2 });
  ok(r.enviar === true && r.etapa === 3 && r.marcoDias === 60, `atraso 60, 2 feitas -> envia etapa 3 (${r.enviar}/${r.etapa})`); }

// 6) régua esgotada (3 feitas) → não envia, motivo esgotada (vai pro extrajudicial)
{ const r = tentativaDaRegua({ diasAtraso: 90, tentativasFeitas: 3 });
  ok(r.enviar === false && r.motivo === 'esgotada', `3 feitas -> esgotada (${r.enviar}/${r.motivo})`); }

// 7) catch-up: unidade descoberta tarde (atraso 100, 0 feitas) → envia etapa 1 (1 por vez, não pula)
{ const r = tentativaDaRegua({ diasAtraso: 100, tentativasFeitas: 0 });
  ok(r.enviar === true && r.etapa === 1, `atraso 100, 0 feitas -> envia etapa 1 (catch-up, 1 por vez) (${r.etapa})`); }

// 8) marcos customizáveis por opts (não hardcode)
{ const r = tentativaDaRegua({ diasAtraso: 5, tentativasFeitas: 0 }, { marcos: [5, 10, 15] });
  ok(r.enviar === true && r.etapa === 1 && r.marcoDias === 5, `marcos custom [5,10,15] -> envia etapa 1 no dia 5 (${r.enviar}/${r.marcoDias})`); }

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(falhas ? 1 : 0);
