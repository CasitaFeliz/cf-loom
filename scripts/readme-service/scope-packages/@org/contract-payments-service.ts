import { type Endpoint, openEnumReader, providedEndpoint, providedEvent } from '@cf-loom/contract';
import { exportedCutOf, identityOf, snapshotOf, validateRoot } from '@cf-loom/contract/internal';
import { apiKey, definitions, idempotencyKey } from '@org/definitions';
import { z } from 'zod';
import { createPayment } from '../../payments-service/src/contract/endpoints/payments/create-payment.endpoint.ts';
import { getPayment } from '../../payments-service/src/contract/endpoints/payments/get-payment.endpoint.ts';
import { contract } from '../../payments-service/src/contract/index.ts';

const provider = {
  name: 'payments-service',
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

type DeclaredHeaders<Declared extends Endpoint> = Declared['input'] extends {
  readonly headers: z.ZodObject<infer Shape>;
}
  ? Shape
  : Record<never, never>;

/**
 * The Endpoint as its Contract Package exports it: its Input's headers merged with the headers its
 * Guard demands, as `cf-loom package` merges them, and its exported Snapshot cut.
 */
function provided<const Declared extends Endpoint, const Demanded extends z.ZodRawShape>(
  endpoint: Declared,
  demanded: z.ZodObject<Demanded>,
) {
  const declared =
    endpoint.input?.headers instanceof z.ZodObject ? endpoint.input.headers.shape : {};
  const headers = z.object({ ...declared, ...demanded.shape }) as z.ZodObject<
    Omit<DeclaredHeaders<Declared>, keyof Demanded> & Demanded
  >;
  const input = { ...endpoint.input, headers } as Omit<
    NonNullable<Declared['input']>,
    'headers'
  > & {
    readonly headers: typeof headers;
  };
  const cut = exportedCutOf(snapshot, identityOf(endpoint.method, endpoint.path));
  return providedEndpoint(provider, { ...endpoint, input }, cut);
}

export const getPaymentEndpoint = provided(getPayment, apiKey.demands.headers);
export const createPaymentEndpoint = provided(createPayment, idempotencyKey.demands.headers);

export const paymentSettledEventV1 = providedEvent(provider.name, {
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled',
  body: z.object({ paymentId: z.string(), method: openEnumReader(['card', 'transfer']) }),
});
