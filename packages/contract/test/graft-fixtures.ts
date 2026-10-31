import {
  type CodeSnapshot,
  type Defs,
  type EndpointFields,
  type EndpointSnapshot,
  type Field,
  type FormerInput,
  type ObjectNode,
  type PublishedServiceSnapshot,
  publishedSnapshotOf,
  type SchemaNode,
  type ServiceSnapshot,
} from '../src/internal/index.ts';
import { publishedAt } from './snapshots.ts';

export const emptyObject = { type: 'object', fields: {} } as const;
export const aString: SchemaNode = { type: 'string' };

const standardRejections: ServiceSnapshot['standardRejections'] = {
  invalidInput: 'INVALID_INPUT',
  notFound: 'NOT_FOUND',
  notImplemented: 'NOT_IMPLEMENTED',
};

/** What the Standard Rejections resolve to in the Snapshots these fixtures build. */
export const standardCodes: Readonly<Record<string, CodeSnapshot>> = {
  [standardRejections.invalidInput]: aCode({ body: emptyObject }),
  [standardRejections.notFound]: aCode({ status: 404 }),
  [standardRejections.notImplemented]: aCode({ status: 501 }),
};

/** A code with the fields given, a Standard one otherwise. */
export function aCode(fields: Partial<CodeSnapshot>): CodeSnapshot {
  return {
    origin: 'standard',
    status: 400,
    message: 'Standard',
    headers: emptyObject,
    body: null,
    ...fields,
  };
}

/** A required field. */
export function required(schema: SchemaNode): Field {
  return { required: true, schema };
}

/** An optional field. */
export function optional(schema: SchemaNode): Field {
  return { required: false, schema };
}

/** An object with the fields given. */
export function anObject(fields: Readonly<Record<string, Field>>): ObjectNode {
  return { type: 'object', fields };
}

/** A `ref` to the def named. */
export function aRef(name: string): SchemaNode {
  return { type: 'ref', name };
}

/** An Endpoint with the Input body given, or none, and the rest as given. */
export function anEndpointOf(
  body: SchemaNode | null,
  fields: Partial<EndpointFields> = {},
): EndpointSnapshot {
  return {
    name: 'putOrder',
    group: 'orders',
    visibility: 'public',
    description: 'Puts an order',
    params: [],
    guards: [],
    input: { params: null, query: emptyObject, headers: emptyObject, body },
    success: { status: 200, headers: emptyObject, body: null },
    rejections: [],
    lifecycle: 'active',
    ...fields,
  };
}

/** The orders Service declaring the Endpoints and defs given, and the codes given beside the Standard ones. */
export function aServiceOf(
  endpoints: Readonly<Record<string, EndpointSnapshot>>,
  defs: Defs,
  codes: Readonly<Record<string, CodeSnapshot>> = {},
): ServiceSnapshot {
  return {
    format: 1,
    kind: 'service',
    name: 'orders-service',
    standardRejections,
    groups: { orders: { description: 'Orders' } },
    defs,
    endpoints,
    events: {},
    commands: {},
    guards: {},
    codes: { ...standardCodes, ...codes },
    subscriptions: {},
    dependencies: {},
  };
}

/** The Service published for the first time, as 1.0.0. */
export function publishedFirst(service: ServiceSnapshot): PublishedServiceSnapshot {
  return publishedSnapshotOf(undefined, service, publishedAt('1.0.0'));
}

/** What a shape is checked and merged against. */
export type Shape = {
  readonly baseline: PublishedServiceSnapshot;
  readonly proposed: ServiceSnapshot;
};

/** `count` Endpoints, `PUT /e0`, `PUT /e1`…, each with the body `bodyOf` gives for its index. */
export function endpointsOf(
  count: number,
  bodyOf: (index: number) => SchemaNode | null,
): Readonly<Record<string, EndpointSnapshot>> {
  const entries = Array.from({ length: count }, (_, index): [string, EndpointSnapshot] => [
    `PUT /e${index}`,
    anEndpointOf(bodyOf(index)),
  ]);
  return Object.fromEntries(entries);
}

/** `count` objects `c0`, `c1`…, each holding the one before it by `next`, the first holding a string. */
export function aChainOfObjects(count: number): Defs {
  const entries = Array.from({ length: count }, (_, index): [string, SchemaNode] => {
    const next = index === 0 ? aString : aRef(`c${index - 1}`);
    return [`c${index}`, anObject({ next: required(next) })];
  });
  return Object.fromEntries(entries);
}

/** `count` defs `a0`, `a1`…, the first an object described `description`, each other an alias of the one before. */
export function aChainOfAliases(count: number, description: string): Defs {
  const first = { ...anObject({ leaf: required(aString) }), description };
  const aliases = Array.from({ length: count - 1 }, (_, index): [string, SchemaNode] => [
    `a${index + 1}`,
    aRef(`a${index}`),
  ]);
  return { a0: first, ...Object.fromEntries(aliases) };
}

/** An Endpoint answering with the head of a chain of `count` defs, which no Input reaches. */
export function chainEndpointOf(count: number): EndpointSnapshot {
  const success = { status: 200, headers: emptyObject, body: aRef(`c${count - 1}`) };
  return anEndpointOf(null, { name: 'getChain', success });
}

/** The Service published as 1.1.0 holding the Former Inputs given, which a publish would write, in the order a Snapshot keeps them. */
export function publishedHolding(
  service: ServiceSnapshot,
  formerInputs: readonly FormerInput[],
): Shape {
  const byEndpoint = formerInputs.toSorted((left, right) =>
    left.endpoint < right.endpoint ? -1 : 1,
  );
  return { baseline: { ...publishedFirst(service), formerInputs: byEndpoint }, proposed: service };
}

/** The identity of the one Endpoint a seeded draw declares. */
export const graftedIdentity = 'PUT /e';

/** A version of the Service declaring the one Endpoint with the Input body given and the defs given. */
export function aVersionOf(body: ObjectNode, defs: Defs): ServiceSnapshot {
  return aServiceOf({ [graftedIdentity]: anEndpointOf(body) }, defs);
}
