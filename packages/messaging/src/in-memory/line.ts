/** How many deliveries run before the line cuts what is still lined up. */
const limit = 1000;

/** What a cut says, and what `settled()` rejects with when a chain of Messages is cut. */
const cutMessage = `a chain of Messages was cut after ${limit.toLocaleString('en-US')} deliveries`;

/** The error a cut drops a delivery with, which `settled()` reports. */
class Cut extends Error {}

/** Whether a delivery was dropped by a cut, rather than failing on its own. */
export function isCut(reason: unknown): boolean {
  return reason instanceof Cut;
}

/** One delivery lined up: what it runs, and how its caller hears of a cut or of being left. */
type LinedUp = {
  readonly run: () => Promise<void>;
  readonly drop: (cut: Error) => void;
  readonly leave: () => void;
};

/**
 * The one delivery line of a `memory()`: deliveries run one at a time in the order they were lined
 * up, only while something drives it, and a chain that keeps lining up more is cut after 1,000
 * deliveries.
 */
export class DeliveryLine {
  readonly #lined: LinedUp[] = [];
  readonly #onCut: (cut: Error) => void;
  #running: PromiseWithResolvers<void> | undefined;
  #budget = 0;
  #started = 0;

  constructor(onCut: (cut: Error) => void) {
    this.#onCut = onCut;
  }

  /** Lines a delivery up; settles as it settles once it ran, as `leave` answers if it is left, or rejects with the cut that dropped it. */
  add<Result>(run: () => Promise<Result>, leave: () => Result): Promise<Result> {
    return new Promise((resolve, reject) => {
      this.#lined.push({
        run: () => run().then(resolve, reject),
        drop: reject,
        leave: () => resolve(leave()),
      });
    });
  }

  /** Runs every delivery lined up, and those the deliveries line up meanwhile, until none is; resolves once the line is idle. */
  driveAll(): Promise<void> {
    return this.#drive(Number.POSITIVE_INFINITY);
  }

  /** Runs at least the deliveries lined up now, and none lined up after them, so what they line up waits; resolves when the line stops. */
  driveLined(): Promise<void> {
    return this.#drive(this.#lined.length);
  }

  /** Leaves every delivery still lined up unrun, each answering as it was told to. */
  leaveAll(): void {
    for (const { leave } of this.#lined.splice(0)) {
      leave();
    }
  }

  #drive(budget: number): Promise<void> {
    this.#budget = Math.max(this.#budget, budget);
    const running = this.#running ?? this.#begin();
    return running.promise;
  }

  #begin(): PromiseWithResolvers<void> {
    const running = Promise.withResolvers<void>();
    this.#running = running;
    void this.#drain(running);
    return running;
  }

  async #drain(running: PromiseWithResolvers<void>): Promise<void> {
    while (this.#lined.length > 0 && this.#budget > 0) {
      if (this.#started === limit) {
        this.#cut();
        break;
      }
      this.#started += 1;
      this.#budget -= 1;
      await this.#lined.shift()?.run();
    }
    this.#budget = 0;
    this.#started = 0;
    this.#running = undefined;
    running.resolve();
  }

  #cut(): void {
    const cut = new Cut(cutMessage);
    const dropped = this.#lined.splice(0);
    this.#onCut(cut);
    for (const { drop } of dropped) {
      drop(cut);
    }
  }
}
