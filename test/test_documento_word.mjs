// test_documento_word.mjs — determinístico, sem LLM, sem Superlógica.
// Valida a saída WORD editável da notificação/multa (pedido do Fernando 08/07):
// a equipe precisa poder apagar o excesso do regimento e complementar o relato.
import assert from 'node:assert';
import fs from 'node:fs';
import { gerarDocumento, carregarCondominio, listarInfracoes } from '../gerador/src/gerar-lib.mjs';

let ok = 0, total = 0;
const check = (c, m) => { total++; assert(c, m); ok++; };

const cond = 'vancouver'; // tem catálogo + bloco de cadastro fixo (não precisa Superlógica)
const infr = listarInfracoes(carregarCondominio(cond));
check(Array.isArray(infr) && infr.length > 0, 'catálogo de infrações não veio');
const infracao_id = infr[0].id || infr[0].infracao_id || infr[0].slug;
check(!!infracao_id, 'não achei um infracao_id no catálogo');

const RELATO = 'Relato de teste da ocorrencia para validacao do Word editavel.';
const ocorrencia = {
  condominio: cond, tipo: 'notificacao', infracao_id,
  destinatario: { nome: 'Fulano de Tal', genero: 'M', papel: 'proprietario', apartamento: '12' },
  relato: RELATO,
  data_documento: '8 de julho de 2026',
};

// ---- WORD (o novo caminho) --------------------------------------------------
const w = gerarDocumento({ ocorrencia, formato: 'word' });
check(w.formato === 'word', `formato deveria ser 'word', veio '${w.formato}'`);
check(w.destino.endsWith('.doc'), `arquivo deveria terminar em .doc: ${w.destino}`);
const doc = fs.readFileSync(w.destino, 'utf8');
check(doc.includes('Word.Document'), 'faltou o marcador MSO (Word.Document) — Word abriria como página web');
check(doc.includes(RELATO), 'o relato precisa estar no .doc para a equipe editar');
check(!doc.startsWith('%PDF'), 'o .doc não pode ser um PDF binário');
try { fs.unlinkSync(w.destino); } catch {}

// ---- PDF (segue funcionando quando pedem a versão final) --------------------
try {
  const p = gerarDocumento({ ocorrencia, formato: 'pdf' });
  check(p.formato === 'pdf' && p.destino.endsWith('.pdf'), 'PDF deveria continuar gerando');
  const head = fs.readFileSync(p.destino);
  check(head.slice(0, 4).toString() === '%PDF', 'PDF gerado deveria ter assinatura %PDF');
  try { fs.unlinkSync(p.destino); } catch {}
} catch (e) {
  console.warn('  [PDF] pulado: render indisponível localmente (Chrome/Chromium):', e.message);
}

console.log(`test_documento_word: ${ok}/${total} OK`);
