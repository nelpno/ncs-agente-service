// test_portaria_dispatch.mjs — conector de aviso MULTI-DESTINO por tipo_portaria (redesenho 11/07).
// planejarAviso agora é ASSÍNCRONA (contatos podem vir do Supabase via condominio_contatos.mjs) — todo
// chamador usa await. Continua puro/determinístico: sem SUPABASE_URL no ambiente de teste, resolverContatos
// cai no JSON local (data/portaria/condominio_contatos.json, hoje vazio) — daí "sem_contato" nos casos sem
// `contatos` injetado.
import { planejarAviso } from '../src/portaria_dispatch.mjs';

let ok = 0, fail = 0;
const check = (n, c) => { if (c) ok++; else { fail++; console.log(`  ❌ ${n}`); } };
const dOf = (p, papel) => (p.destinos || []).find((d) => d.papel === papel);
const ator = { nome: 'Fulano', papel: 'inquilino', unidade: 'Apto 42', telefone: '16 99999-0000' };

// 1) Aristocrata (Alarm System, Virtual) → e-mail à portaria remota + zap ao síndico
const p1 = await planejarAviso({ condominio: 'Aristocrata', ator });
check('Aristocrata → 2 destinos', p1.destinos?.length === 2);
check('Aristocrata → portaria por e-mail conhecido', dOf(p1, 'portaria')?.canal === 'email' && dOf(p1, 'portaria')?.endereco === 'portaria@alarmsystem.com.br' && dOf(p1, 'portaria')?.status === 'pronto');
check('Aristocrata → síndico por zap, contato já cadastrado', dOf(p1, 'sindico')?.canal === 'zap_individual' && dOf(p1, 'sindico')?.status === 'pronto' && dOf(p1, 'sindico')?.endereco === '5516996285367');

// 2) Lume (Shielder, Humana) → zap grupo da portaria + zap síndico. Síndico já cadastrado (Alexandre
//    Scalise, síndico profissional multi-condomínio); o JID do grupo da portaria ainda falta capturar.
const p2 = await planejarAviso({ condominio: 'Lume', ator });
check('Lume → portaria por zap_grupo', dOf(p2, 'portaria')?.canal === 'zap_grupo');
check('Lume → síndico por zap_individual', dOf(p2, 'sindico')?.canal === 'zap_individual');
check('Lume → síndico pronto, grupo da portaria sem JID ainda', dOf(p2, 'sindico')?.status === 'pronto' && dOf(p2, 'portaria')?.status === 'sem_contato');

// 3) Amarige (GatWay) → só o síndico (portaria não avisa)
const p3 = await planejarAviso({ condominio: 'Amarige', ator });
check('Amarige → 1 destino (só síndico)', p3.destinos?.length === 1 && dOf(p3, 'sindico'));
check('Amarige → sem destino de portaria', !dOf(p3, 'portaria'));

// 4) Atlanta (override) → portaria via zap_individual (Tiago) + síndico
const p4 = await planejarAviso({ condominio: 'Atlanta', ator });
check('Atlanta → portaria zap_individual via Tiago', dOf(p4, 'portaria')?.canal === 'zap_individual' && /Tiago/.test(dOf(p4, 'portaria')?.via || ''));

// 5) Flores (override) → portaria por e-mail (síndica) + síndico
const p5 = await planejarAviso({ condominio: 'Flores', ator });
check('Flores → portaria por e-mail via síndica', dOf(p5, 'portaria')?.canal === 'email' && /síndica/.test(dOf(p5, 'portaria')?.via || ''));

// 6) Aracaju (Synnus) → portaria via zeladora
const p6 = await planejarAviso({ condominio: 'Aracaju', ator });
check('Aracaju → portaria zap_individual via zeladora', dOf(p6, 'portaria')?.canal === 'zap_individual' && /zeladora/.test(dOf(p6, 'portaria')?.via || ''));

// 7) alias "Studio 5" → Studio Five (Alarm System)
const p7 = await planejarAviso({ condominio: 'Studio 5', ator });
check('Studio 5 (alias) → resolve + e-mail Alarm System', p7.ok && dOf(p7, 'portaria')?.endereco === 'portaria@alarmsystem.com.br');

// 8) desconhecido → não resolve
const p8 = await planejarAviso({ condominio: 'Inexistente XPTO', ator });
check('desconhecido → ok:false', p8.ok === false);

// 9) com contatos injetados → status vira 'pronto'
const p9 = await planejarAviso({ condominio: 'Lume', ator, contatos: { lume: { sindico_whatsapp: '5516999990000', portaria_grupo_jid: '123@g.us' } } });
check('Lume c/ contatos → ambos prontos', p9.destinos.every((d) => d.status === 'pronto'));
check('Lume c/ contatos → grupo resolvido', dOf(p9, 'portaria')?.endereco === '123@g.us');

// 10) texto do aviso vem do template (data/templates/cadastro-portaria.md) — fallback nunca aparece p/ evento 'cadastro'
check('Lume → payload usa o template (menção a "acesso na portaria")', /acesso na portaria/.test(dOf(p2, 'portaria')?.payload || ''));
check('Lume → payload do síndico usa o template dele ("ciência")', /ciência/.test(dOf(p2, 'sindico')?.payload || ''));

// 11) evento sem template (.md inexistente) → cai no fallback textual, não quebra
const p11 = await planejarAviso({ evento: 'evento_sem_template_xyz', condominio: 'Lume', ator });
check('evento sem template → fallback não vazio', typeof dOf(p11, 'portaria')?.payload === 'string' && dOf(p11, 'portaria').payload.length > 0);

console.log(`\n${fail === 0 ? '✅' : '❌'} planejarAviso: ${ok} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
