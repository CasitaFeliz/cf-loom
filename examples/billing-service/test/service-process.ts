import { basename } from 'node:path';
import {
  type Exit,
  startProcess,
  stopProcess,
  untilListening,
} from '../../../packages/messaging/test/test-process.ts';

const listeningLine = /listening on (\d+)\n/;

/** A Service's `main.ts` a test started as a process of its own. */
export type ServiceProcess = {
  /** The port the Service printed that it listens on. */
  readonly port: number;
  /** The end of what the process wrote to stderr, kept in a bounded buffer. */
  readonly stderr: () => string;
  /** Sends SIGTERM and resolves with how the process exited; calling it again returns the same promise. */
  readonly stop: () => Promise<Exit>;
};

/**
 * Starts `node src/main.ts` in the Service's directory with exactly `env` and nothing inherited, so
 * no NATS_URL reaches it but the test server's; it resolves once the Service prints the port it
 * listens on, and rejects with what it wrote to stderr when it exits first.
 */
export async function aServiceProcess(
  serviceDir: string,
  env: Readonly<Record<string, string>>,
): Promise<ServiceProcess> {
  const server = startProcess(process.execPath, ['src/main.ts'], { cwd: serviceDir, env });
  const port = await untilListening(server, basename(serviceDir), () =>
    portPrinted(server.stdout()),
  );
  let stopping: Promise<Exit> | undefined;
  const stop = (): Promise<Exit> => {
    stopping ??= stopProcess(server);
    return stopping;
  };
  return { port, stderr: server.stderr, stop };
}

function portPrinted(stdout: string): number | undefined {
  const port = listeningLine.exec(stdout)?.[1];
  return port === undefined ? undefined : Number(port);
}
