import { isRejection } from '../declarations/index.ts';
import type { Declarations } from './declarations.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import type { LocatedDefinitions } from './located.ts';
import { reachedGuardsOf } from './references.ts';
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
  const reached = reachedGuardsOf(listOf(definitions.guards));
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
