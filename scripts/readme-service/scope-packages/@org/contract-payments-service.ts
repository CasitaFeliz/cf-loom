import {
  defineEndpoint,
  defineGroup,
  defineService,
  openEnumReader,
  providedEndpoint,
  providedEvent,
} from '@cf-loom/contract';
import { exportedCutOf, identityOf, snapshotOf, validateRoot } from '@cf-loom/contract/internal';
import { z } from 'zod';

const payments = {
  name: 'payments-service',
  standardRejections: {
    invalidInput: {
      code: 'BAD_REQUEST',
      status: 400,
      message: 'The request is invalid',
      body: z.object({ issues: z.array(z.object({ message: z.string() })) }),
    },
    notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
    notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented yet' },
  },
} as const;

const getPayment = defineEndpoint({
  name: 'getPayment',
  method: 'GET',
  path: '/payments/:paymentId',
  visibility: 'public',
  description: 'One payment by id',
  input: { params: z.object({ paymentId: z.string() }) },
  success: { status: 200, body: z.object({ paymentId: z.string() }) },
});

/** The Snapshot the Provider exports, from which its Contract Package cuts each Endpoint. */
function exportedSnapshot() {
  const group = defineGroup({ name: 'payments', description: 'Payments', endpoints: [getPayment] });
  const root = defineService({ name: payments.name, groups: [group] });
  const rootPackage = {
    packageName: payments.name,
    packages: [],
    contractPackages: [],
    rootExports: {},
  };
  const validated = validateRoot(root, rootPackage);
  if (validated.kind !== 'valid') {
    throw new Error(`The payments Contract is invalid: ${JSON.stringify(validated.failures)}`);
  }
  const snapshot = snapshotOf(validated);
  if (snapshot.kind !== 'service') {
    throw new Error('The payments Contract is no Service');
  }
  return snapshot;
}

const cut = exportedCutOf(exportedSnapshot(), identityOf(getPayment.method, getPayment.path));

export const getPaymentEndpoint = providedEndpoint(payments, getPayment, cut);

export const paymentSettledEventV1 = providedEvent(payments.name, {
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled',
  body: z.object({ paymentId: z.string(), method: openEnumReader(['card', 'transfer']) }),
});
