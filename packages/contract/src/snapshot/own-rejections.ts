import { addedStandardRejectionNames } from '../declarations/index.ts';
import { reachedGuardNamesOf } from './reached-guards.ts';
import type { EndpointSnapshot, ServiceSnapshot } from './types.ts';

/** A Rejection an Endpoint lists itself: the Standard not-found one, or a declared one by its code. */
export type ListedRejection =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'declared'; readonly code: string };

/**
 * The Rejections an Endpoint lists itself, read back from its resolved codes: all but those of the
 * Guards it reaches and those cf-loom's runtime adds, which it gets again by attaching its Guards.
 */
export function ownRejectionsOf(
  endpoint: EndpointSnapshot,
  snapshot: Pick<ServiceSnapshot, 'standardRejections' | 'guards'>,
): readonly ListedRejection[] {
  const { standardRejections } = snapshot;
  const added = new Set(addedStandardRejectionNames.map((name) => standardRejections[name].code));
  const attached = endpoint.guards.map(({ guard }) => guard);
  for (const guard of reachedGuardNamesOf(attached, snapshot.guards)) {
    for (const code of snapshot.guards[guard]?.rejections ?? []) {
      added.add(code);
    }
  }
  const own = endpoint.rejections.filter((code) => !added.has(code));
  const notFoundCode = standardRejections.notFound.code;
  return own.map(
    (code): ListedRejection =>
      code === notFoundCode ? { kind: 'not-found' } : { kind: 'declared', code },
  );
}

/** Whether a listed Rejection is a declared one, which has a code of its own to write and to keep. */
export function isDeclaredRejection(
  rejection: ListedRejection,
): rejection is Extract<ListedRejection, { readonly kind: 'declared' }> {
  return rejection.kind === 'declared';
}
