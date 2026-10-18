import { type Guard, isGuard, isRejection } from '../declarations/index.ts';
import type { Declarations } from './declarations.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import type { LocatedDefinitions } from './located.ts';
import { listOf, textOf } from './written.ts';

/**
 * A Definitions Package lists every Guard and Rejection its Guards reach, through their `guards`
 * and their `rejections`, so where each came from is read from the package's lists alone.
 */
export function unlistedFailures({ allPackages }: Declarations): readonly DeclarationFailure[] {
  return allPackages.flatMap(packageFailures);
}

function packageFailures({ at, definitions }: LocatedDefinitions): readonly DeclarationFailure[] {
  const listedGuards: readonly unknown[] = listOf(definitions.guards);
  const listedRejections: readonly unknown[] = listOf(definitions.rejections);
  const reached = reachedGuardsOf(listOf(definitions.guards).filter(isGuard));
  const rejections = [...new Set(reached.flatMap((guard) => listOf(guard.rejections)))];
  const unlistedGuards = reached.filter((guard) => !listedGuards.includes(guard));
  const unlistedRejections = rejections
    .filter(isRejection)
    .filter((rejection) => !listedRejections.includes(rejection));
  return [
    ...unlistedGuards.map(({ name }) =>
      failure([...at, 'guards'], 'definitions-unlisted', `${guardsMessage}: ${textOf(name)}`),
    ),
    ...unlistedRejections.map(({ code }) =>
      failure(
        [...at, 'rejections'],
        'definitions-unlisted',
        `${rejectionsMessage}: ${textOf(code)}`,
      ),
    ),
  ];
}

const guardsMessage = 'A Definitions Package lists every Guard its Guards reach';
const rejectionsMessage = 'A Definitions Package lists every Rejection its Guards reach';

/** Every Guard the listed ones reach, each once: themselves and, through `guards`, the ones they name. */
function reachedGuardsOf(listed: readonly Guard[]): readonly Guard[] {
  const reached: Guard[] = [];
  const pending = [...listed];
  for (let guard = pending.shift(); guard !== undefined; guard = pending.shift()) {
    if (!reached.includes(guard)) {
      reached.push(guard);
      pending.push(...listOf(guard.guards).filter(isGuard));
    }
  }
  return reached;
}
