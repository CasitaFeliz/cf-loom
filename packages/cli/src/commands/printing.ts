import { unbrokenLineOf } from '@cf-loom/contract/internal';
import { firstLineOf } from '../child-process/index.ts';
import type { ExitStatus } from './exit.ts';

/** How writing to a stream ended: written, closed by its reader, or failed. */
type Printed =
  | { readonly kind: 'printed' }
  | { readonly kind: 'closed' }
  | { readonly kind: 'failed'; readonly reason: string };

/** A stream the CLI writes lines to, which never throws and never waits on a reader that has gone. */
export type Printer = {
  /** Writes the lines now, unless the stream has closed or failed. */
  readonly print: (lines: readonly string[]) => void;
  /** Resolves once every write has ended, with how writing went. */
  readonly settled: () => Promise<Printed>;
};

/**
 * A printer to a stream, with the one `error` listener that keeps a reader that closed the
 * stream, as `head` does, from crashing the CLI.
 */
export function printerTo(stream: NodeJS.WritableStream): Printer {
  let failure: Error | undefined;
  let last: Promise<void> = Promise.resolve();
  const failed = (error: Error | null | undefined) => {
    failure ??= error ?? undefined;
  };
  stream.on('error', failed);
  return {
    print: (lines) => {
      if (lines.length === 0 || failure !== undefined) {
        return;
      }
      const text = lines.map((line) => `${unbrokenLineOf(line)}\n`).join('');
      last = new Promise((resolve) => {
        stream.write(text, (error) => {
          failed(error);
          resolve();
        });
      });
    },
    settled: async () => {
      await last;
      return printedOf(failure);
    },
  };
}

function printedOf(failure: Error | undefined): Printed {
  if (failure === undefined) {
    return { kind: 'printed' };
  }
  const isClosed = 'code' in failure && failure.code === 'EPIPE';
  return isClosed ? { kind: 'closed' } : { kind: 'failed', reason: firstLineOf(failure.message) };
}

/** The two streams the CLI writes to. */
export type Streams = { readonly stdout: Printer; readonly stderr: Printer };

/**
 * The status the CLI ends with once its output is written: the command's, whether or not a
 * reader closed a stream; 3 when a stream failed, with a line on stderr if that still works.
 */
export async function statusAfterPrinting(
  status: ExitStatus,
  { stdout, stderr }: Streams,
): Promise<ExitStatus> {
  const [out, err] = await Promise.all([stdout.settled(), stderr.settled()]);
  if (out.kind !== 'failed' && err.kind !== 'failed') {
    return status;
  }
  if (out.kind === 'failed') {
    stderr.print([`cf-loom cannot write stdout: ${out.reason}`]);
  }
  await stderr.settled();
  return 3;
}
