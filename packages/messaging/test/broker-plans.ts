import {
  defineCommand,
  defineEvent,
  defineGroup,
  defineService,
  defineSubscription,
  type ServiceContract,
} from '@cf-loom/contract';
import {
  type BrokerPlan,
  brokerPlanOf,
  providerOf,
  snapshotOf,
  validateRoot,
} from '@cf-loom/contract/internal';
import { z } from 'zod';

/** The broker plan `cf-loom broker-plan` derives from a Service's Contract under a prefix. */
export function planOf(contract: ServiceContract, prefix: string | null): BrokerPlan {
  return brokerPlanOf(serviceSnapshotOf(contract), prefix);
}

/** A Service whose names have 64 characters, a Subscription's with the most capitals, its Command at the largest Message Version, and the longest Broker prefix. */
export function aServiceOfLongestNames() {
  const body = z.object({ orderId: z.string() });
  const kebab = 'a'.repeat(64);
  const subscribed = `aa${'Bb'.repeat(31)}`;
  const pascal = (initial: string) => `${initial}${'a'.repeat(63)}`;
  const created = defineEvent({
    name: pascal('A'),
    version: 1,
    visibility: 'internal',
    description: 'An order was created',
    body,
  });
  const charge = defineCommand({
    name: pascal('B'),
    version: Number.MAX_SAFE_INTEGER,
    description: 'Charges the order’s card',
    body,
  });
  const onCreated = defineSubscription({
    name: subscribed,
    description: 'Receives the order created',
    event: created,
  });
  const group = defineGroup({
    name: kebab,
    description: 'Messages',
    events: [created],
    commands: [charge],
    subscriptions: [onCreated],
  });
  return {
    contract: defineService({ name: kebab, groups: [group] }),
    prefix: 'p'.repeat(64),
  };
}

/** The Snapshot of a Service's Contract, each Provider whose Events it receives installed as a Contract Package at 1.0.0. */
function serviceSnapshotOf(contract: ServiceContract) {
  const received = (contract.groups ?? [])
    .flatMap((group) => group.subscriptions ?? [])
    .map(({ event }) => event);
  const providers = new Set(received.map((event) => providerOf(event)));
  providers.delete(undefined);
  const contractPackages = [...providers].map((provider) => ({
    kind: 'identified' as const,
    packageName: `@org/contract-${provider}`,
    version: '1.0.0',
    elements: received.filter((event) => providerOf(event) === provider),
    reaches: [],
  }));
  const validated = validateRoot(contract, {
    packageName: contract.name,
    packages: [],
    contractPackages,
    rootExports: {},
  });
  if (validated.kind !== 'valid') {
    throw new Error(`The fixture is invalid: ${JSON.stringify(validated.failures)}`);
  }
  const snapshot = snapshotOf(validated);
  if (snapshot.kind !== 'service') {
    throw new Error('The fixture is no Service');
  }
  return snapshot;
}
