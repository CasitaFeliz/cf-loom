import { linesTextOf } from '@cf-loom/contract/internal';

/** What went wrong in a delivery: the lines it reports, and the error behind them, if any. */
export type Failure = { readonly lines: readonly string[]; readonly cause: unknown };

/** The failures since `settled()` last reported, which it reports once. */
export class Failures {
  readonly #recorded: Failure[] = [];

  record(failure: Failure): void {
    this.#recorded.push(failure);
  }

  /** Throws one Error with a line per failure and the first failure's cause, then forgets them all. */
  report(): void {
    const failures = this.#recorded.splice(0);
    const [first] = failures;
    if (first === undefined) {
      return;
    }
    const lines = failures.flatMap((failure) => failure.lines);
    throw new Error(linesTextOf(lines), { cause: first.cause });
  }
}
