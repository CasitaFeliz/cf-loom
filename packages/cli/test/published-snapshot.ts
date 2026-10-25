import type { PublishedSnapshot } from '@cf-loom/contract/internal';

type Kind = 'service' | 'application' | 'definitions';

/** The package a published Snapshot describes: its kind and its name. */
export type Declared = { readonly kind: Kind; readonly name: string };

export const orders = { kind: 'service', name: 'orders-service' } as const satisfies Declared;
export const ordersPackage = '@org/contract-orders-service';

const invalidInputCode = 'INVALID_INPUT';
const notFoundCode = 'NOT_FOUND';
const notImplementedCode = 'NOT_IMPLEMENTED';

const standardRejections: Extract<PublishedSnapshot, { kind: 'service' }>['standardRejections'] = {
  invalidInput: invalidInputCode,
  notFound: notFoundCode,
  notImplemented: notImplementedCode,
};

const standardCodes = {
  [invalidInputCode]: {
    origin: 'standard',
    status: 400,
    message: 'Invalid',
    body: { type: 'object', fields: {} },
    removed: false,
  },
  [notFoundCode]: {
    origin: 'standard',
    status: 404,
    message: 'Not found',
    body: null,
    removed: false,
  },
  [notImplementedCode]: {
    origin: 'standard',
    status: 501,
    message: 'No',
    body: null,
    removed: false,
  },
} as const;

const serviceBody = {
  kind: 'service',
  definitions: {},
  standardRejections,
  defs: {},
  endpoints: {},
  events: {},
  commands: {},
  guards: {},
  codes: standardCodes,
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
  codes: standardCodes,
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
