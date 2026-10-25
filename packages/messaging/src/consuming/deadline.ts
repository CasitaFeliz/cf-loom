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

/**
 * One delivery's end: the signal its Handler runs with, aborted when messaging starts closing or
 * when its wait passes; the run raced against that wait, and the whole settle against the hand-back.
 */
export class DeliveryEnd {
  readonly #controller = new AbortController();
  readonly #waitMs: number | undefined;
  readonly #ends: DeliveryEnds;
  #stopWaiting: () => void = () => undefined;

  constructor(waitMs: number | undefined, ends: DeliveryEnds) {
    this.#waitMs = waitMs;
    this.#ends = ends;
  }

  /** The signal the Handler receives in its meta. */
  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  /** Whether `close`'s signal handed the delivery back, so nothing more is told of it. */
  get handedBack(): boolean {
    return this.#ends.handingBack.aborted;
  }

  /** The settle, or `'handed-back'` once `close`'s signal aborts first; the Handler's signal follows closing meanwhile, and the wait stops with it. */
  async unlessHandedBack(settling: Promise<Settled>): Promise<Settled> {
    const { closing, handingBack } = this.#ends;
    const abort = () => this.#controller.abort(closing.reason);
    const handing = Promise.withResolvers<Settled>();
    const handBack = () => handing.resolve(handedBack);
    whenAborted(closing, abort);
    whenAborted(handingBack, handBack);
    try {
      return await Promise.race([settling, handing.promise]);
    } finally {
      closing.removeEventListener('abort', abort);
      handingBack.removeEventListener('abort', handBack);
      this.#stopWaiting();
    }
  }

  /** The Handler's run, or a `thrown` `DeadlineError` once its wait passes first, aborting its signal. */
  async withinWait(running: Promise<MessageRun>): Promise<MessageRun> {
    const waitMs = this.#waitMs;
    if (waitMs === undefined) {
      return await running;
    }
    const passed = Promise.withResolvers<MessageRun>();
    this.#stopWaiting = afterWait(waitMs, () => {
      const deadline = new DeadlineError(waitMs);
      this.#controller.abort(deadline);
      passed.resolve({ kind: 'thrown', cause: deadline });
    });
    try {
      return await Promise.race([running, passed.promise]);
    } finally {
      this.#stopWaiting();
    }
  }
}

/** Calls `aborted` when the signal aborts, or now if it has. */
function whenAborted(signal: AbortSignal, aborted: () => void): void {
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
