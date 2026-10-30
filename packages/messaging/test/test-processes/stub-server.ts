import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';

/**
 * Stands in for `moto_server` and `nats-server` in the fixtures of `test-processes.test.ts`. It logs its pid and its
 * `-sd` store, then does what its mode says: `silent` never listens, `serves` listens as moto does, `deaf` listens and
 * ignores SIGTERM. It ends itself after a minute, so a failing run leaves nothing behind.
 */
const [mode, pidsFile, storesFile, ...args] = process.argv.slice(2);

appendFileSync(pidsFile ?? '', `${process.pid}\n`);
const store = args[args.indexOf('-sd') + 1];
if (args.includes('-sd') && store !== undefined) {
  appendFileSync(storesFile ?? '', `${store}\n`);
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
