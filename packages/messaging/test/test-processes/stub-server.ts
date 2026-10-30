import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';

/**
 * Stands in for `moto_server` and `nats-server` in the fixtures of `test-processes.test.ts`; its mode says whether it
 * listens and whether it answers SIGTERM. It logs its pid to the file `STUB_PIDS` names once started, after the
 * `warming up` a silent one writes to stderr. It ends itself when its parent, the fixture's Vitest worker, ends
 * without killing it.
 */
const [mode] = process.argv.slice(2);
const parent = process.ppid;
const parentCheckIntervalMs = 100;

setInterval(() => {
  if (process.ppid !== parent) {
    process.exit(1);
  }
}, parentCheckIntervalMs);

if (mode === 'silent') {
  process.stderr.write('warming up\n');
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
appendFileSync(process.env['STUB_PIDS'] ?? '', `${process.pid}\n`);
