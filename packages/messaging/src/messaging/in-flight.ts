import type { Settled } from '../consuming/index.ts';
import type { HandedBack } from './closed.ts';

/** A delivery settling, with what names it should `close` hand it back. */
type Delivering = { readonly settling: Promise<Settled>; readonly named: HandedBack };

/**
 * What one messaging has in flight, which `close` waits for: a `publish`, a `send`, the adapter's
 * `consume`, a trouble report and each delivery settling; and the hand-back of those deliveries.
 */
export class InFlight {
  readonly #calls = new Map<Promise<unknown>, Delivering | undefined>();
  readonly #handingBack = new AbortController();
  readonly #idle: () => void;

  /** Calls `idle` each time the last call in flight settles. */
  constructor(idle: () => void) {
    this.#idle = idle;
  }

  /** The signal every delivery still settling settles `'handed-back'` on, at once. */
  get handingBack(): AbortSignal {
    return this.#handingBack.signal;
  }

  /** Whether nothing is in flight. */
  get isIdle(): boolean {
    return this.#calls.size === 0;
  }

  /** A call in flight until it settles. */
  tracked<Result>(call: Promise<Result>): Promise<Result> {
    this.#calls.set(call, undefined);
    this.#forgetOnceSettled(call);
    return call;
  }

  /** A delivery in flight until it settles, named in case `close` hands it back. */
  delivering(settling: Promise<Settled>, named: HandedBack): Promise<Settled> {
    this.#calls.set(settling, { settling, named });
    this.#forgetOnceSettled(settling);
    return settling;
  }

  /** Hands back every delivery still settling, and names those whose Settlement says they were handed back. */
  async handedBack(): Promise<readonly HandedBack[]> {
    this.#handingBack.abort();
    const deliveries = [...this.#calls.values()].filter(isDelivering);
    const named = await Promise.all(deliveries.map(handedBackOf));
    return named.filter(isHandedBack);
  }

  #forgetOnceSettled(call: Promise<unknown>): void {
    const forget = () => {
      this.#calls.delete(call);
      if (this.isIdle) {
        this.#idle();
      }
    };
    call.then(forget, forget);
  }
}

/** What names a delivery once it settled, if it settled `'handed-back'`. */
async function handedBackOf({ settling, named }: Delivering): Promise<HandedBack | undefined> {
  const { settlement } = await settling;
  return settlement === 'handed-back' ? named : undefined;
}

function isDelivering(call: Delivering | undefined): call is Delivering {
  return call !== undefined;
}

function isHandedBack(named: HandedBack | undefined): named is HandedBack {
  return named !== undefined;
}
