import { addedStandardRejectionNames } from '../declarations/index.ts';
import type { EndpointSnapshot, ServiceSnapshot } from './types.ts';

/** A Rejection an Endpoint lists itself: the Standard not-found one, or a declared one by its code. */
export type ListedRejection =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'declared'; readonly code: string };

/** Whether an Element still works, so it has a Handler and a Contract Package may export it: not Retired. */
export function isLive(element: { readonly lifecycle?: string | undefined }): boolean {
  return element.lifecycle !== 'retired';
}

/** Whether a Contract Package exports an Endpoint: Public or Internal, and not Retired. */
export function isExportedEndpoint(endpoint: EndpointSnapshot): boolean {
  return endpoint.visibility !== 'private' && isLive(endpoint);
}

/**
 * The Rejections an Endpoint lists itself, read back from its resolved codes: all but its
 * Guards' and those cf-loom's runtime adds, which it gets again by attaching its Guards.
 */
export function ownRejectionsOf(
  endpoint: EndpointSnapshot,
  snapshot: ServiceSnapshot,
): readonly ListedRejection[] {
  const { standardRejections } = snapshot;
  const added = new Set(addedStandardRejectionNames.map((name) => standardRejections[name].code));
  for (const { guard } of endpoint.guards) {
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
