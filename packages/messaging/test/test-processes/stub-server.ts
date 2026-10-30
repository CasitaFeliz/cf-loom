import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';

/**
 * Stands in for `moto_server` and `nats-server` in the fixtures of `test-processes.test.ts`, logging its pid and its
 * `-sd` store; its mode says whether it listens and whether it answers SIGTERM, and a minute after it starts it ends
 * itself, so a failing run leaves nothing behind.
 */
const [mode, pidsFile = '', storesFile = '', ...args] = process.argv.slice(2);

appendFileSync(pidsFile, `${process.pid}\n`);
const storeAt = args.indexOf('-sd');
if (storeAt >= 0) {
  appendFileSync(storesFile, `${args[storeAt + 1]}\n`);
}
setTimeout(() => process.exit(1), 60_000);

if (mode === 'silent') {
  process.stderr.write('warming up\n');
  setInterval(() => undefined, 1_000);
} else {
  const server = createServer((_request, response) => response.end('ok'));
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    process.stderr.write(` * Running on http://127.0.0.1:${port}\n`);
  });
}
if (mode === 'deaf') {
  process.on('SIGTERM', () => undefined);
}
