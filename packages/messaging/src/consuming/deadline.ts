import type { MessageRun } from '@cf-loom/handlers/internal';
import type { Settled } from './details.ts';

/** The longest delay a Node timer takes; a longer one fires after 1 ms. */
const longestTimerMs = 2_147_483_647;

/** Why a Message Handler was no longer waited for: its delivery's wait, how long the Broker waits for its acknowledgement, passed. */
export class DeadlineError extends Error {
  override readonly name = 'DeadlineError';
  readonly waitMs: number;

  constructor(waitMs: number) {
    super(`The Handler ran past its delivery's wait of ${waitMs} ms`);
    this.waitMs = waitMs;
  }
}

/** What ends a delivery before its Handler does: messaging closing, and `close`'s signal handing it back. */
export type DeliveryEnds = { readonly closing: AbortSignal; readonly handingBack: AbortSignal };

/** A delivery handed back by `close`'s signal: its Handler's answer, if any comes, is not waited for. */
const handedBack: Settled = { settlement: 'handed-back', fault: undefined, hookFailure: undefined };

const noWait = () => undefined;

/** One delivery, from its Handler's run to its Settlement: the signal its Handler runs with, and how long it is waited for. */
export class OneDelivery {
  readonly #controller = new AbortController();
  readonly #waitMs: number | undefined;
  readonly #ends: DeliveryEnds;

  constructor(waitMs: number | undefined, ends: DeliveryEnds) {
    this.#waitMs = waitMs;
    this.#ends = ends;
  }

  /** The signal the Handler receives in its meta: aborted when messaging starts closing, or once its wait passed. */
  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  /**
   * The Settlement `settle` makes of the run, or of a `thrown` `DeadlineError` once the wait passed
   * first; `'handed-back'` once `close`'s signal aborts first. Nothing of it outlives the delivery.
   */
  async settled(
    running: Promise<MessageRun>,
    settle: (run: MessageRun) => Promise<Settled>,
  ): Promise<Settled> {
    const { closing, handingBack } = this.#ends;
    const handing = Promise.withResolvers<Settled>();
    const passed = Promise.withResolvers<MessageRun>();
    const abort = () => this.#controller.abort(closing.reason);
    const handBack = () => handing.resolve(handedBack);
    whenAborted(closing, abort);
    whenAborted(handingBack, handBack);
    const stopWaiting = this.#waitFor(passed.resolve);
    const ran = Promise.race([running, passed.promise]);
    const reported = ran.then((run) => {
      stopWaiting();
      return handingBack.aborted ? handedBack : settle(run);
    });
    try {
      return await Promise.race([reported, handing.promise]);
    } finally {
      closing.removeEventListener('abort', abort);
      handingBack.removeEventListener('abort', handBack);
      stopWaiting();
    }
  }

  /** Answers a `thrown` `DeadlineError` once the wait passed, aborting the signal; answers what stops it. */
  #waitFor(passed: (run: MessageRun) => void): () => void {
    const waitMs = this.#waitMs;
    if (waitMs === undefined) {
      return noWait;
    }
    return afterWait(waitMs, () => {
      const deadline = new DeadlineError(waitMs);
      this.#controller.abort(deadline);
      passed({ kind: 'thrown', cause: deadline });
    });
  }
}

/** Calls `aborted` when the signal aborts, or now if it has. */
export function whenAborted(signal: AbortSignal, aborted: () => void): void {
  if (signal.aborted) {
    aborted();
    return;
  }
  signal.addEventListener('abort', aborted, { once: true });
}

/** Calls `passed` once `waitMs` has passed, timed in steps a Node timer holds; answers what stops it. */
function afterWait(waitMs: number, passed: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (leftMs: number) => {
    const stepMs = Math.min(leftMs, longestTimerMs);
    timer = setTimeout(() => (leftMs > stepMs ? arm(leftMs - stepMs) : passed()), stepMs);
  };
  arm(waitMs);
  return () => clearTimeout(timer);
}
