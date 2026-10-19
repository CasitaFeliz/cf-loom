import type { Endpoint, StandardRejections } from '@casitafeliz/loom-contract';
import {
  type AnswerableRejection,
  answerableRejectionsOf,
  type ObjectNode,
  resolutionOf,
  walkSchemas,
} from '@casitafeliz/loom-contract/internal';
import type * as core from 'zod/v4/core';

/**
 * One listed Endpoint as the client calls it and reads its answers, prepared once: the header
 * names its Input declares, its Success headers' nodes, and its Rejections by their resolved code.
 */
export type CalledEndpoint = {
  readonly provider: string;
  readonly name: string;
  readonly endpoint: Endpoint;
  readonly inputHeaderNames: ReadonlySet<string>;
  readonly successHeaders: ObjectNode | undefined;
  readonly rejectionsByCode: ReadonlyMap<string, AnswerableRejection>;
  readonly standards: StandardRejections;
};

/** The Dependency an Endpoint is called through: its Provider and the Standard codes it resolved. */
export type Providing = { readonly provider: string; readonly standards: StandardRejections };

/** An Endpoint a Dependency lists, prepared for calling. */
export function calledEndpointOf(endpoint: Endpoint, providing: Providing): CalledEndpoint {
  const inputHeaders = objectNodeOf(endpoint, endpoint.input?.headers);
  const rejections = answerableRejectionsOf(endpoint).map(
    (rejection) => [resolutionOf(rejection, providing.standards).code, rejection] as const,
  );
  return {
    provider: providing.provider,
    name: endpoint.name,
    endpoint,
    inputHeaderNames: new Set(Object.keys(inputHeaders?.fields ?? {})),
    successHeaders: objectNodeOf(endpoint, endpoint.success.headers),
    rejectionsByCode: new Map(rejections),
    standards: providing.standards,
  };
}

/** The node of a headers object, which a Contract Package's Endpoint always declares walkably. */
function objectNodeOf(
  endpoint: Endpoint,
  schema: core.$ZodType | undefined,
): ObjectNode | undefined {
  if (schema === undefined) {
    return undefined;
  }
  const [located] = walkSchemas([{ at: [], schema }], () => undefined).located;
  if (located?.walked.kind !== 'walked' || located.walked.value.type !== 'object') {
    throw new Error(`The headers of ${endpoint.name} are no object of text fields`);
  }
  return located.walked.value;
}
