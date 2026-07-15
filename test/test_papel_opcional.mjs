// test_papel_opcional.mjs — determinístico, sem LLM, sem Superlógica.
// Nasceu do uso real de 14/07 (piloto): quando `buscar_morador` não acha a unidade e a equipe
// informou só o NOME, o schema OBRIGAVA o campo `papel` — o modelo não tinha como omitir e
// escrevia "morador" por conta própria num documento de peso jurídico (medido: 4/5 rodadas).
// O motor NUNCA exigiu `papel`: sem ele renderiza o termo neutro "responsável" (gerar-lib.mjs:60).
// Este teste trava as duas pontas do contrato: schema NÃO exige, motor degrada pro neutro.
import assert from 'node:assert';
import fs from 'node:fs';
import { gerarDocumento, carregarCondominio, listarInfracoes } from '../gerador/src/gerar-lib.mjs';
import { TOOLS } from '../estagiario/src/agent.mjs';

let ok = 0, total = 0;
const check = (c, m) => { total++; assert(c, m); ok++; };

// ---- 1) SCHEMA: `papel` não pode ser obrigatório (senão o modelo é forçado a inventar) -------
const gd = TOOLS.find((t) => t.function?.name === 'gerar_documento');
check(!!gd, 'tool gerar_documento não encontrada');
const req = gd.function.parameters.properties.destinatario.required || [];
check(!req.includes('papel'), `'papel' NÃO pode estar em required (força o modelo a chutar): [${req}]`);
check(req.includes('nome') && req.includes('apartamento'), `'nome' e 'apartamento' seguem obrigatórios: [${req}]`);

// ---- 2) MOTOR: sem `papel` → termo NEUTRO "responsável", sem quebrar ------------------------
const cond = 'vancouver';
const infracao_id = listarInfracoes(carregarCondominio(cond))[0].id;
const base = {
  condominio: cond, tipo: 'notificacao', infracao_id,
  relato: 'Relato de teste para validar o papel opcional.',
  data_documento: '14 de julho de 2026',
};
// cadastro injetado = teste hermético (não depende do Superlógica nem de bloco fixo no catálogo).
const CADASTRO = { nome: 'CONDOMINIO TESTE', endereco: 'RUA X, 1', cep: '14800-000', cidade_uf: 'ARARAQUARA/SP', cidade_fecho: 'Araraquara' };
// Lê o TEXTO VISÍVEL do documento, não o HTML: o que importa aqui é a PALAVRA que sai para o
// leitor ("responsável"/"proprietário"), não a marcação em volta. Sem isso o teste quebra por
// formatação — o negrito estrutural (14/07) passou a envolver "apartamento 101" em <b>, e a frase
// continua idêntica para quem lê. As asserções abaixo seguem as mesmas, agora à prova de tags.
const semTags = (h) => h.replace(/<[^>]+>/g, '');
const gerar = (destinatario) => {
  const r = gerarDocumento({ ocorrencia: { ...base, destinatario }, cadastro: CADASTRO, formato: 'word' });
  const html = fs.readFileSync(r.destino, 'utf8');
  try { fs.unlinkSync(r.destino); } catch {}
  return semTags(html);
};

const semPapel = gerar({ nome: 'Joao Carlos da Silva', genero: 'M', apartamento: '101' });
check(/respons[áa]vel do apartamento 101/i.test(semPapel), 'sem papel → deveria sair "responsável" (neutro)');
check(!/morador do apartamento 101/i.test(semPapel), 'sem papel NÃO pode afirmar "morador" (dado que ninguém informou)');
check(!/propriet[áa]rio do apartamento 101/i.test(semPapel), 'sem papel NÃO pode afirmar "proprietário" (relação jurídica falsa)');

// ---- 3) Com papel informado, nada muda (não pode regredir) ----------------------------------
check(/propriet[áa]rio do apartamento 101/i.test(gerar({ nome: 'Joao Carlos da Silva', genero: 'M', papel: 'proprietario', apartamento: '101' })),
  'com papel=proprietario → deveria sair "proprietário"');
check(/inquilina do apartamento 101/i.test(gerar({ nome: 'Maria Silva', genero: 'F', papel: 'inquilino', apartamento: '101' })),
  'com papel=inquilino + genero=F → deveria sair "inquilina"');

console.log(`test_papel_opcional: ${ok}/${total} OK`);
