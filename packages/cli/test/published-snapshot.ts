import type { PublishedSnapshot } from '@cf-loom/contract/internal';

type Kind = 'service' | 'application' | 'definitions';

/** The package a published Snapshot describes: its kind and its name. */
export type Declared = { readonly kind: Kind; readonly name: string };

export const orders = { kind: 'service', name: 'orders-service' } as const satisfies Declared;
export const ordersPackage = '@org/contract-orders-service';

const standardRejections: Extract<PublishedSnapshot, { kind: 'service' }>['standardRejections'] = {
  invalidInput: {
    origin: 'standard',
    code: 'INVALID_INPUT',
    status: 400,
    message: 'Invalid',
    body: { type: 'object', mode: 'strict', fields: {} },
  },
  notFound: { origin: 'standard', code: 'NOT_FOUND', status: 404, message: 'Not found' },
  notImplemented: { origin: 'standard', code: 'NOT_IMPLEMENTED', status: 501, message: 'No' },
};

const serviceBody = {
  kind: 'service',
  definitions: {},
  standardRejections,
  defs: {},
  endpoints: {},
  events: {},
  commands: {},
  guards: {},
  codes: {},
  subscriptions: {},
  dependencies: {},
} as const;

const applicationBody = { kind: 'application', dependencies: {} } as const;

const definitionsBody = {
  kind: 'definitions',
  standardRejections,
  defs: {},
  schemas: {},
  guards: {},
  codes: {},
} as const;

/** The Snapshot of a package that declares nothing, as a registry holds it for `version`. */
export function aPublishedSnapshot(declared: Declared, version: string): PublishedSnapshot {
  const heading = {
    format: 1 as const,
    name: declared.name,
    version,
    generator: '@cf-loom/cli@0.0.0',
  };
  switch (declared.kind) {
    case 'service':
      return { ...heading, ...serviceBody };
    case 'application':
      return { ...heading, ...applicationBody };
    case 'definitions':
      return { ...heading, ...definitionsBody };
  }
}
