// gen_mapas.mjs — gera o doc de validação da diretoria (mapa portaria + garantidora) a partir dos dados REAIS.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planejarAviso } from '../src/portaria_dispatch.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const D = path.join(__dirname, '..', 'data');
const sistemas = JSON.parse(fs.readFileSync(path.join(D, 'portaria', 'sistemas-portaria.json'), 'utf8')).condominios;
const gdb = JSON.parse(fs.readFileSync(path.join(D, 'garantidoras.json'), 'utf8'));

const canalTxt = { zap_grupo: 'WhatsApp (grupo da portaria)', zap_individual: 'WhatsApp', email: 'e-mail', web_form: 'formulário web', nenhum: '—' };
async function comoAvisa(nome) {
  const p = await planejarAviso({ condominio: nome });
  if (!p.ok) return '—';
  return p.destinos.map((d) => `${d.papel === 'sindico' ? 'síndico' : 'portaria'}: ${canalTxt[d.canal]}${d.via ? ' (' + d.via + ')' : ''}`).join(' + ');
}

let md = `# Mapas para validação da diretoria NCS — Onda 1

*Conferir se está tudo certo. É a base dos avisos automáticos que a IA vai disparar.*

## 1. Portarias — 39 condomínios

| Condomínio | Sistema | Tipo | Como a IA avisa |
|---|---|---|---|
`;
for (const c of sistemas) {
  md += `| ${c.nome} | ${c.sistema} | ${c.tipo_portaria} | ${await comoAvisa(c.nome)} |\n`;
}

md += `\n> ⚠️ Onde diz **"WhatsApp"** sem contato, precisamos do número (síndico) ou do grupo (portaria) — item 2 das pendências.\n`;
md += `> "Não Identificado" (Atlanta, Flores): já ajustados por regra específica (Tiago / e-mail da síndica).\n`;

md += `\n## 2. Garantidoras — 8 condomínios

| Condomínio | Garantidora | E-mail | Tipo |
|---|---|---|---|
`;
for (const c of gdb.condominios) {
  const g = gdb.garantidoras[c.garantidora] || {};
  md += `| ${c.nome} | ${c.garantidora} | ${g.email || '—'} | ${c.tipo} |\n`;
}
md += `\n> "Total" = a NCS não gera boleto (a garantidora emite). "Allure" = boleto normal a NCS gera; só a inadimplência vai à garantidora.\n`;

const out = path.join(__dirname, '..', '..', '..', 'comunicacao-fernando', 'mapas-validacao-diretoria.md');
fs.writeFileSync(out, md, 'utf8');
console.log('OK ->', out);
console.log(`portarias=${sistemas.length} garantidoras=${gdb.condominios.length}`);
