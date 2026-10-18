import { type Definitions, isGuard, isRejection } from '../declarations/index.ts';
import type { Declarations } from './declarations.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import type { LocatedDefinitions } from './located.ts';
import { reachedGuardsOf } from './references.ts';
import { listOf, textOf } from './written.ts';

/** What a Definitions Package's module exports, as the tooling imported it: nothing when unknown. */
export type ExportsOf = (definitions: Definitions) => readonly unknown[];

/**
 * A Definitions Package lists every Guard and Rejection it exports or its Guards reach, through
 * their `guards` and their `rejections`, so where each came from is read from its lists alone.
 */
export function unlistedFailures(
  { allPackages }: Declarations,
  exportsOf: ExportsOf,
): readonly DeclarationFailure[] {
  return allPackages.flatMap((located) => packageFailures(located, exportsOf(located.definitions)));
}

function packageFailures(
  { at, definitions }: LocatedDefinitions,
  exported: readonly unknown[],
): readonly DeclarationFailure[] {
  const listedGuards: readonly unknown[] = listOf(definitions.guards);
  const listedRejections: readonly unknown[] = listOf(definitions.rejections);
  const reached = reachedGuardsOf([...listedGuards, ...exported.filter(isGuard)]);
  const answered = reached.flatMap((guard) => listOf(guard.rejections));
  const rejections = [...new Set([...answered, ...exported])].filter(isRejection);
  const unlistedGuards = reached.filter((guard) => !listedGuards.includes(guard));
  const unlistedRejections = rejections.filter(
    (rejection) => !listedRejections.includes(rejection),
  );
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

const guardsMessage = 'A Definitions Package lists every Guard it exports or its Guards reach';
const rejectionsMessage =
  'A Definitions Package lists every Rejection it exports or its Guards reach';
