import {
  type Attachment,
  addedStandardRejectionNames,
  type Endpoint,
  type Guard,
} from '../declarations/index.ts';
import {
  attachedGuardOf,
  identityOf,
  type LocatedEndpoint,
  paramNamesOf,
  slotAt,
} from '../validation/index.ts';
import { codeOfStandard, sortedCodes } from './codes.ts';
import { inMode, objectOf, type Sources } from './context.ts';
import { deprecationOf } from './deprecation.ts';
import { inputOf } from './input.ts';
import type { AttachmentSnapshot, EndpointSnapshot, SuccessSnapshot } from './types.ts';

/** Every Endpoint by its identity, its Input merged and its codes resolved. */
export function endpointsOf(
  endpoints: readonly LocatedEndpoint[],
  sources: Sources,
  stamping: { readonly committed: unknown; readonly now: number },
): Readonly<Record<string, EndpointSnapshot>> {
  const entries = endpoints.map((located) => {
    const identity = identityOf(located.endpoint.method, located.endpoint.path);
    const lifecycle = located.endpoint.lifecycle ?? 'active';
    const deprecation = deprecationOf({ identity, lifecycle, ...stamping });
    return [identity, { ...endpointOf(located, sources), lifecycle, ...deprecation }] as const;
  });
  return Object.fromEntries(entries);
}

function endpointOf(
  located: LocatedEndpoint,
  sources: Sources,
): Omit<EndpointSnapshot, 'lifecycle' | 'deprecatedAt'> {
  const { endpoint, group } = located;
  const guards = guardsOf(endpoint);
  return {
    name: endpoint.name,
    group: group.name,
    visibility: endpoint.visibility,
    description: endpoint.description,
    params: paramNamesOf(endpoint.path),
    guards: (endpoint.guards ?? []).map(attachmentOf),
    input: inputOf(located, guards, sources),
    success: successOf(located, sources),
    rejections: rejectionsOf(endpoint, guards, sources),
  };
}

/** The Guards an Endpoint attaches, in Attachment order. */
function guardsOf(endpoint: Endpoint): readonly Guard[] {
  return (endpoint.guards ?? []).map(attachedGuardOf).filter(isAttached);
}

function isAttached(guard: Guard | undefined): guard is Guard {
  return guard !== undefined;
}

function attachmentOf(attachment: Attachment): AttachmentSnapshot {
  if ('guard' in attachment) {
    return { guard: attachment.guard.name, qualifier: attachment.qualifier };
  }
  return { guard: attachment.name, qualifier: null };
}

function successOf({ at, endpoint }: LocatedEndpoint, { nodeAt }: Sources): SuccessSnapshot {
  return {
    status: endpoint.success.status,
    headers: inMode(objectOf(nodeAt(slotAt(at, 'success.headers'))), 'open'),
    body: nodeAt(slotAt(at, 'success.body')),
  };
}

/** The Endpoint's own codes, its Guards', and the two the runtime adds to every Endpoint. */
function rejectionsOf(
  endpoint: Endpoint,
  guards: readonly Guard[],
  { standards }: Sources,
): readonly string[] {
  const own = (endpoint.rejections ?? []).map((rejection) =>
    rejection.kind === 'standard-rejection'
      ? codeOfStandard(standards, rejection.name)
      : rejection.code,
  );
  const ofGuards = guards.flatMap((guard) => (guard.rejections ?? []).map(({ code }) => code));
  const added = addedStandardRejectionNames.map((name) => codeOfStandard(standards, name));
  return sortedCodes([...own, ...ofGuards, ...added]);
}
