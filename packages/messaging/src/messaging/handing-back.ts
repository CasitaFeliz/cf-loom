import type { Delivery } from '../broker/index.ts';
import type { Named, Settled } from '../consuming/index.ts';
import type { HandedBack } from './closed.ts';

/** The deliveries whose Handlers still run, each with what names it, which `close`'s signal hands back. */
export class DeliveriesInFlight {
  readonly #handingBack = new AbortController();
  readonly #settling = new Map<Promise<Settled>, HandedBack>();

  /** The signal every delivery settles `'handed-back'` on, at once, when it aborts. */
  get handingBack(): AbortSignal {
    return this.#handingBack.signal;
  }

  /** Keeps a delivery while it settles, named by its consumer and its ids. */
  add(settling: Promise<Settled>, named: Named, { messageId, factId }: Delivery): void {
    this.#settling.set(settling, { ...named, messageId, factId });
    const forget = () => this.#settling.delete(settling);
    settling.then(forget, forget);
  }

  /** Hands back every delivery still settling, each of which then resolves at once, and names those handed back. */
  async handBack(): Promise<readonly HandedBack[]> {
    this.#handingBack.abort();
    const settling = [...this.#settling];
    const settled = await Promise.all(settling.map(([delivery]) => delivery));
    return settling
      .filter((_delivery, index) => settled[index]?.settlement === 'handed-back')
      .map(([, handedBack]) => handedBack);
  }
}
