// test_docia_tool.mjs — a costura da tool na Ana (sem rede, sem LLM).
// O check nº1 não é a tool funcionar: é ela NÃO EXISTIR com a flag desligada. A imagem da Ana builda
// do HEAD do git — qualquer sessão que deployar leva este código. Se a flag vazar, o DocIA entra em
// produção sem ensaio, que é exatamente como nasceram os 5 bugs de 15/07.
import { TOOLS, runToolReal, toolsAtivas } from '../src/agent.mjs';
import { adicionarPeca, pecasDe, limpar } from '../src/docia/dossie.mjs';

let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };
const temTool = (n) => TOOLS.some((t) => t.function.name === n);

// ---------- ⚠️ O CHECK QUE IMPORTA: com a flag desligada, a Ana NEM VÊ a tool ----------
const ativa = () => toolsAtivas().some((t) => t.function.name === 'analisar_contrato');
ok(temTool('analisar_contrato'), 'a tool está declarada em TOOLS');

delete process.env.DOCIA_ATIVO;
ok(ativa() === false, 'DOCIA_ATIVO ausente → tool NÃO é oferecida ao modelo (prod intacto)');
process.env.DOCIA_ATIVO = '0';
ok(ativa() === false, 'DOCIA_ATIVO=0 → tool NÃO é oferecida');
process.env.DOCIA_ATIVO = 'true';
ok(ativa() === false, 'só "1" liga — "true" não vaza a tool por engano');
process.env.DOCIA_ATIVO = '1';
ok(ativa() === true, 'DOCIA_ATIVO=1 → tool entra (ato deliberado, sem rebuild)');
delete process.env.DOCIA_ATIVO;
ok(ativa() === false, 'desligar a flag remove a tool de novo (rollback é env, não deploy)');

// as demais tools da Ana não são afetadas pela flag em nenhum estado
const semFlag = toolsAtivas().map((t) => t.function.name);
process.env.DOCIA_ATIVO = '1';
const comFlag = toolsAtivas().map((t) => t.function.name);
delete process.env.DOCIA_ATIVO;
ok(comFlag.length === semFlag.length + 1, 'ligar a flag adiciona exatamente 1 tool, não mexe nas outras');
ok(semFlag.every((n) => comFlag.includes(n)), 'nenhuma tool existente some quando a flag liga');
ok(semFlag.includes('get_boleto_2via') && semFlag.includes('criar_rascunho_cadastro'), 'as tools de produção seguem no catálogo com a flag desligada');

const schema = TOOLS.find((t) => t.function.name === 'analisar_contrato');
ok(schema.function.description.includes('laudo'), 'a descrição explica que devolve um laudo');
ok(/nunca diga que o cadastro está aprovado/i.test(schema.function.description), 'a descrição PROÍBE dizer que aprovou (quem aprova é a equipe)');
ok(/sugest/i.test(schema.function.description), 'responsavel_taxa vai como SUGESTÃO, não decisão');
ok(!schema.function.parameters.required, 'nenhum parâmetro é obrigatório (sem id/unidade o laudo degrada, não quebra)');

// ---------- sem documento: não inventa, não quebra ----------
limpar('ct-tool');
const semDoc = await runToolReal('analisar_contrato', {}, { dossieKey: 'ct-tool' });
ok(semDoc.ok === false && semDoc.motivo === 'sem_documento', 'sem página no dossiê → sem_documento (não chama LLM à toa)');
ok(typeof semDoc.mensagem === 'string' && semDoc.mensagem.length > 10, 'devolve mensagem em português para a Ana repassar');

// ---------- o dossiê é limpo SEMPRE, inclusive quando a análise falha ----------
// Sem isto, a página de um contrato antigo entra calada na análise do próximo (sessão vive 120min).
limpar('ct-falha');
adicionarPeca('ct-falha', { mime: 'image/jpeg', buf: Buffer.alloc(64, 1) });
ok(pecasDe('ct-falha').length === 1, 'dossiê tem 1 página antes');
const ctxFalha = { dossieKey: 'ct-falha' };
const r = await runToolReal('analisar_contrato', {}, ctxFalha); // sem GEMINI_API_KEY → falha controlada
ok(r.ok === false, `análise falha sem chave (motivo=${r.motivo}) — controlada, sem exceção`);
ok(pecasDe('ct-falha').length === 0, 'o dossiê foi limpo MESMO com a análise falhando (não contamina o próximo)');

// ---------- ERP ausente não derruba a tool ----------
limpar('ct-erp');
adicionarPeca('ct-erp', { mime: 'image/jpeg', buf: Buffer.alloc(64, 2) });
const rErp = await runToolReal('analisar_contrato', { id_condominio: '179', id_unidade: '900' }, { dossieKey: 'ct-erp' });
ok(rErp.ok === false && !!rErp.motivo, 'com id/unidade e Superlógica fora, retorna motivo — não lança');

limpar('ct-tool'); limpar('ct-falha'); limpar('ct-erp');
console.log(falhas === 0 ? '\n✅ todos os checks passaram' : `\n❌ ${falhas} falha(s)`);
process.exitCode = falhas ? 1 : 0;
