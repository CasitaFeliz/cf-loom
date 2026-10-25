import { type FakeProviderError, mistakeOf } from '../mistakes/index.ts';
import { onceStepsOf } from '../scripting/index.ts';
import type { Faking } from './fetch.ts';

/**
 * Throws what a test got wrong so far, wherever the code under test caught it: every mistake the
 * fake threw, then each Endpoint's `once` steps no request took. It forgets nothing, so it throws
 * again on every call.
 */
export function throwMistakesOf(faking: Faking): void {
  const mistakes = [...faking.mistakes, ...unusedStepsOf(faking)];
  const [first, ...others] = mistakes;
  if (first === undefined) {
    return;
  }
  if (others.length === 0) {
    throw first;
  }
  throw new AggregateError(mistakes, summaryOf(mistakes));
}

/** One mistake for each Endpoint with `once` steps no request took. */
function unusedStepsOf({ provided, scripted }: Faking): readonly FakeProviderError[] {
  const unused: FakeProviderError[] = [];
  for (const [endpoint, steps] of scripted) {
    const left = steps.tally().unused;
    if (left > 0) {
      const what = `${onceStepsOf(left)} left unused`;
      unused.push(mistakeOf({ provider: provided.provider, endpoint, what }));
    }
  }
  return unused;
}

/** The count of mistakes, then the first line of each. */
function summaryOf(mistakes: readonly FakeProviderError[]): string {
  const lines = mistakes.map((mistake) => mistake.message.split('\n')[0]);
  return [`${mistakes.length} mistakes:`, ...lines].join('\n');
}
