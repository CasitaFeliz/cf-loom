/** How many deliveries run before the line cuts what is still lined up. */
const limit = 1000;

/** What a cut says, and what `settled()` rejects with when a chain of Messages is cut. */
const cutMessage = `a chain of Messages was cut after ${limit.toLocaleString('en-US')} deliveries`;

/** One delivery lined up: what it runs, and how its caller hears of a cut. */
type LinedUp = {
  readonly run: () => Promise<void>;
  readonly drop: (cut: Error) => void;
};

/**
 * The one delivery line of a `memory()`: deliveries run one at a time in the order they were lined
 * up, on their own, and a chain that keeps lining up more is cut after 1,000 deliveries.
 */
export class DeliveryLine {
  readonly #lined: LinedUp[] = [];
  readonly #onCut: (cut: Error) => void;
  #running: PromiseWithResolvers<void> | undefined;
  #started = 0;

  constructor(onCut: (cut: Error) => void) {
    this.#onCut = onCut;
  }

  /** Lines a delivery up; settles as it settles once it ran, or rejects with the cut that dropped it. */
  add<Result>(run: () => Promise<Result>): Promise<Result> {
    return new Promise((resolve, reject) => {
      this.#lined.push({ run: () => run().then(resolve, reject), drop: reject });
      this.#start();
    });
  }

  /** Resolves once nothing is lined up or running. */
  idle(): Promise<void> {
    return this.#running?.promise ?? Promise.resolve();
  }

  #start(): void {
    if (this.#running !== undefined) {
      return;
    }
    this.#running = Promise.withResolvers();
    queueMicrotask(() => void this.#drain());
  }

  async #drain(): Promise<void> {
    while (this.#lined.length > 0) {
      if (this.#started === limit) {
        this.#cut();
        break;
      }
      this.#started += 1;
      await this.#lined.shift()?.run();
    }
    this.#started = 0;
    this.#running?.resolve();
    this.#running = undefined;
  }

  #cut(): void {
    const cut = new Error(cutMessage);
    const dropped = this.#lined.splice(0);
    this.#onCut(cut);
    for (const { drop } of dropped) {
      drop(cut);
    }
  }
}
