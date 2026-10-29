import { type Endpoint, openEnumReader, providedEndpoint, providedEvent } from '@cf-loom/contract';
import type { AttachedGuardsOf } from '@cf-loom/contract/internal';
import { exportedCutOf, identityOf, snapshotOf, validateRoot } from '@cf-loom/contract/internal';
import { definitions } from '@org/definitions';
import { z } from 'zod';
import { createPayment } from '../../payments-service/src/contract/endpoints/payments/create-payment.endpoint.ts';
import { getPayment } from '../../payments-service/src/contract/endpoints/payments/get-payment.endpoint.ts';
import { contract } from '../../payments-service/src/contract/index.ts';

const provider = {
  name: contract.name,
  standardRejections: {
    invalidInput: {
      ...definitions.standardRejections.invalidInput,
      body: z.object({ issues: z.array(z.object({ message: z.string() })) }),
    },
    notFound: definitions.standardRejections.notFound,
    notImplemented: definitions.standardRejections.notImplemented,
  },
} as const;

/** The Snapshot the Provider exports, from which its Contract Package cuts each Endpoint. */
function exportedSnapshot() {
  const rootPackage = {
    packageName: provider.name,
    packages: [],
    contractPackages: [],
    rootExports: {},
  };
  const validated = validateRoot(contract, rootPackage);
  if (validated.kind !== 'valid') {
    throw new Error(`The payments Contract is invalid: ${JSON.stringify(validated.failures)}`);
  }
  const snapshot = snapshotOf(validated);
  if (snapshot.kind !== 'service') {
    throw new Error('The payments Contract is no Service');
  }
  return snapshot;
}
const snapshot = exportedSnapshot();

type TextPart = 'headers' | 'query';

/** The schemas of one text part: the Endpoint's own and those its attached Guards demand. */
type PartSchemasOf<Declared extends Endpoint, Part extends TextPart> =
  | DeclaredPartOf<Declared['input'], Part>
  | DeclaredPartOf<AttachedGuardsOf<Declared>['demands'], Part>;

/** The object schema a declaration writes for a part, never when it writes none. */
type DeclaredPartOf<Declared, Part extends TextPart> = Declared extends {
  readonly [Key in Part]: infer Schema extends z.ZodObject;
}
  ? Schema
  : never;

/** The shapes of a union of object schemas, merged into one. */
type MergedShapeOf<Schemas> = (
  Schemas extends z.ZodObject<infer Shape>
    ? (shape: Shape) => void
    : never
) extends (shape: infer Merged) => void
  ? Merged
  : never;

/** The Input a Caller sends: each text part merged as `cf-loom package` writes it, absent when nothing declares it. */
type CalledInputOf<Declared extends Endpoint> = Omit<NonNullable<Declared['input']>, TextPart> & {
  readonly [Part in TextPart as [PartSchemasOf<Declared, Part>] extends [never]
    ? never
    : Part]: MergedShapeOf<PartSchemasOf<Declared, Part>> extends infer Shape extends z.ZodRawShape
    ? z.ZodObject<Shape>
    : never;
};

/** The Input of the Endpoint with each text part merged from its own and its Guards' schemas. */
function calledInputOf(endpoint: Endpoint) {
  const guards = (endpoint.guards ?? []).map((listed) =>
    'guard' in listed ? listed.guard : listed,
  );
  const input: Record<string, unknown> = { ...endpoint.input };
  for (const part of ['headers', 'query'] as const) {
    const schemas = [endpoint.input?.[part], ...guards.map((guard) => guard.demands?.[part])];
    const shapes = schemas
      .filter((schema) => schema instanceof z.ZodObject)
      .map((schema) => schema.shape);
    if (shapes.length > 0) {
      input[part] = z.object(Object.assign({}, ...shapes));
    }
  }
  return input;
}

/**
 * The Endpoint as its Contract Package exports it, as `cf-loom package` writes it: its Input's
 * headers and query merged with every attached Guard's demands, and its exported Snapshot cut.
 */
function providedEndpointOf<const Declared extends Endpoint>(endpoint: Declared) {
  const input = calledInputOf(endpoint) as CalledInputOf<Declared>;
  const cut = exportedCutOf(snapshot, identityOf(endpoint.method, endpoint.path));
  return providedEndpoint(provider, { ...endpoint, input }, cut);
}

export const getPaymentEndpoint = providedEndpointOf(getPayment);
export const createPaymentEndpoint = providedEndpointOf(createPayment);

export const paymentSettledEventV1 = providedEvent(provider.name, {
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled',
  body: z.object({ paymentId: z.string(), method: openEnumReader(['card', 'transfer']) }),
});
