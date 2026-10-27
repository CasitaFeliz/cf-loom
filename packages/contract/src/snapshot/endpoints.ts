import {
  type Attachment,
  type Endpoint,
  isStandardRejection,
  lifecycleOf,
} from '../declarations/index.ts';
import {
  answerableRejectionsOf,
  attachedGuardsOf,
  identityOf,
  type LocatedEndpoint,
  paramNamesOf,
} from '../written/index.ts';
import { codeOfStandard, sortedCodes } from './codes.ts';
import type { SnapshotSources } from './context.ts';
import { inputOf, textPartOf } from './input.ts';
import type {
  AttachmentSnapshot,
  EndpointFields,
  EndpointLifecycle,
  EndpointSnapshot,
  SuccessSnapshot,
} from './types.ts';

/** Every Endpoint by its identity, its Input merged and its codes resolved. */
export function endpointSnapshotsOf(
  endpoints: readonly LocatedEndpoint[],
  sources: SnapshotSources,
): Readonly<Record<string, EndpointSnapshot>> {
  const entries = endpoints.map(({ endpoint, group }) => {
    const identity = identityOf(endpoint.method, endpoint.path);
    const snapshot = {
      ...endpointOf(endpoint, group.name, sources),
      ...endpointLifecycleOf(endpoint),
    };
    return [identity, snapshot] as const;
  });
  return Object.fromEntries(entries);
}

/** An Endpoint's lifecycle, with the instant it declares it is Deprecated as of when it is Deprecated. */
function endpointLifecycleOf(endpoint: Endpoint): EndpointLifecycle {
  if (endpoint.lifecycle === 'deprecated') {
    return { lifecycle: 'deprecated', deprecatedAt: endpoint.deprecatedAt };
  }
  return { lifecycle: lifecycleOf(endpoint) };
}

function endpointOf(endpoint: Endpoint, group: string, sources: SnapshotSources): EndpointFields {
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
    rejections: rejectionsOf(endpoint, sources),
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
    headers: textPartOf(nodeOf(endpoint, 'success.headers')),
    body: nodeOf(endpoint, 'success.body') ?? null,
  };
}

/** The codes of every Rejection the Endpoint may answer, Standard Rejections resolved. */
function rejectionsOf(endpoint: Endpoint, { standards }: SnapshotSources): readonly string[] {
  const codes = answerableRejectionsOf(endpoint).map((rejection) =>
    isStandardRejection(rejection) ? codeOfStandard(standards, rejection.name) : rejection.code,
  );
  return sortedCodes(codes);
}
