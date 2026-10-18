import {
  type Attachment,
  addedStandardRejectionNames,
  type Endpoint,
  type Guard,
} from '../declarations/index.ts';
import {
  attachedGuardsOf,
  identityOf,
  type LocatedEndpoint,
  paramNamesOf,
} from '../validation/index.ts';
import { codeOfStandard, sortedCodes } from './codes.ts';
import type { SnapshotSources } from './context.ts';
import { deprecationOf, type Stamping } from './deprecation.ts';
import { inputOf } from './input.ts';
import { inMode } from './text-parts.ts';
import type { AttachmentSnapshot, EndpointSnapshot, SuccessSnapshot } from './types.ts';

/** Every Endpoint by its identity, its Input merged and its codes resolved. */
export function endpointSnapshotsOf(
  endpoints: readonly LocatedEndpoint[],
  sources: SnapshotSources,
  stamping: Stamping,
): Readonly<Record<string, EndpointSnapshot>> {
  const entries = endpoints.map(({ endpoint, group }) => {
    const identity = identityOf(endpoint.method, endpoint.path);
    const lifecycle = endpoint.lifecycle ?? 'active';
    const deprecation = deprecationOf({ identity, lifecycle }, stamping);
    const snapshot = { ...endpointOf(endpoint, group.name, sources), lifecycle, ...deprecation };
    return [identity, snapshot] as const;
  });
  return Object.fromEntries(entries);
}

function endpointOf(
  endpoint: Endpoint,
  group: string,
  sources: SnapshotSources,
): Omit<EndpointSnapshot, 'lifecycle' | 'deprecatedAt'> {
  const guards = attachedGuardsOf(endpoint);
  return {
    name: endpoint.name,
    group,
    visibility: endpoint.visibility,
    description: endpoint.description,
    params: paramNamesOf(endpoint.path),
    guards: (endpoint.guards ?? []).map(attachmentOf),
    input: inputOf(endpoint, guards, sources),
    success: successOf(endpoint, sources),
    rejections: rejectionsOf(endpoint, guards, sources),
  };
}

function attachmentOf(attachment: Attachment): AttachmentSnapshot {
  if ('guard' in attachment) {
    return { guard: attachment.guard.name, qualifier: attachment.qualifier };
  }
  return { guard: attachment.name, qualifier: null };
}

function successOf(endpoint: Endpoint, { nodeOf }: SnapshotSources): SuccessSnapshot {
  return {
    status: endpoint.success.status,
    headers: inMode(nodeOf(endpoint, 'success.headers'), 'open'),
    body: nodeOf(endpoint, 'success.body') ?? null,
  };
}

/** The Endpoint's own codes, its Guards', and the two the runtime adds to every Endpoint. */
function rejectionsOf(
  endpoint: Endpoint,
  guards: readonly Guard[],
  { standards }: SnapshotSources,
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
