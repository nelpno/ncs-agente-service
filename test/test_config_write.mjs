// test_config_write.mjs — config do motor de escritas tem defaults seguros
import { config } from '../src/config.mjs';
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'FALHA'} ${m}`); if (!c) falhas++; };

ok(config.dryRunWrites === true, 'dryRunWrites default true (seguro)');
ok(typeof config.auditLogPath === 'string' && config.auditLogPath.length > 0, 'auditLogPath definido');
ok(typeof config.approvalPasscode === 'string', 'approvalPasscode existe (pode herdar chatPasscode)');
ok('slWriteApp' in config && 'slWriteAccess' in config, 'credencial de escrita separada (vazia em DRY_RUN)');
ok('adapterNotifyUrl' in config, 'adapterNotifyUrl existe (vazio = sem push)');

console.log(`\n${falhas === 0 ? 'TODOS OS TESTES VERDES' : falhas + ' FALHA(S)'}`);
process.exit(falhas === 0 ? 0 : 1);
