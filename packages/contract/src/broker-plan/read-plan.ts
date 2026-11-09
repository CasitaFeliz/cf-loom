import { follows, ruleOf, serviceNameGrammar } from '../declarations/index.ts';
import type { Read } from '../validation/index.ts';
import type { Path } from '../walker/index.ts';
import {
  type DurableConsumed,
  type RoutedMessage,
  readDurableName,
  readStreamName,
  readSubject,
  unprefixedNameOf,
  unprefixedSubjectOf,
} from '../wire/index.ts';
import type { BrokerPlan, BrokerPlanDurableConsumer, BrokerPlanStream } from './broker-plan.ts';

/** A Message Version a subject of the plan reads back as, with the Service whose subject it is. */
type ReadSubject = { readonly service: string } & RoutedMessage;

/** A Stream of the plan with its subjects read back. */
type ReadStream = { readonly service: string; readonly subjects: readonly ReadSubject[] };

/** A Durable consumer of the plan with what it consumes and the subject it filters on read back. */
type ReadDurableConsumer = {
  readonly service: string;
  readonly consumed: DurableConsumed;
  readonly subject: ReadSubject;
};

/** A plan with every text of it read back, in the order the plan lists them. */
export type ReadPlan = {
  readonly streams: readonly ReadStream[];
  readonly durableConsumers: readonly ReadDurableConsumer[];
};

/** How a kind of text of the plan is read back: the prefix it carries, the names it is built from and the reason when it is none. */
type TextKind<Value> = {
  readonly unprefixed: (prefix: string | null, text: string) => string | undefined;
  readonly read: (text: string) => Value | undefined;
  readonly reason: string;
};

/** Why a text is no Stream name of the plan, and why a `__proto__` key of its Streams is refused. */
export const notStreamName = 'is not a Stream name: a Service name after the prefix';

/** Why a text is no Durable consumer name of the plan, and why a `__proto__` key of its Durable consumers is refused. */
export const notDurableConsumerName =
  'is not a Durable consumer name: a Service name, then a Subscription name or a Command Version';

const streamName: TextKind<{ readonly service: string }> = {
  unprefixed: unprefixedNameOf,
  read: readStreamName,
  reason: notStreamName,
};

const durableConsumerName: TextKind<{
  readonly service: string;
  readonly consumed: DurableConsumed;
}> = {
  unprefixed: unprefixedNameOf,
  read: readDurableName,
  reason: notDurableConsumerName,
};

const serviceName: TextKind<string> = {
  unprefixed: (_prefix, text) => text,
  read: (text) => (follows(serviceNameGrammar, text) ? text : undefined),
  reason: `is not a Service name, ${ruleOf(serviceNameGrammar)}`,
};

const subject: TextKind<ReadSubject> = {
  unprefixed: unprefixedSubjectOf,
  read: readSubject,
  reason: 'is not a subject: a Service name, event or command, a Message name and its version',
};

/** Where a text sits in the plan, and the text. */
type Site = { readonly at: Path; readonly text: string };

function readText<Value>(kind: TextKind<Value>, prefix: string | null, site: Site): Read<Value> {
  const unprefixed = kind.unprefixed(prefix, site.text);
  if (unprefixed === undefined) {
    return refused(site.at, `does not carry the prefix ${prefix}`);
  }
  const value = kind.read(unprefixed);
  return value === undefined ? refused(site.at, kind.reason) : { kind: 'read', value };
}

function refused(at: Path, reason: string): Read<never> {
  return { kind: 'refused', problems: [{ at, reason }] };
}

/** Every Stream and Durable consumer of the plan with its texts read back, or the first text that does not read back, in document order. */
export function readPlan(plan: BrokerPlan): Read<ReadPlan> {
  const streams = readEntries(plan.streams, (name, stream) =>
    readStream(plan.prefix, name, stream),
  );
  if (streams.kind === 'refused') {
    return streams;
  }
  const durableConsumers = readEntries(plan.durableConsumers, (name, durableConsumer) =>
    readDurableConsumer(plan.prefix, name, durableConsumer),
  );
  if (durableConsumers.kind === 'refused') {
    return durableConsumers;
  }
  return {
    kind: 'read',
    value: { streams: streams.value, durableConsumers: durableConsumers.value },
  };
}

function readEntries<Entry, Item>(
  entries: Readonly<Record<string, Entry>>,
  read: (name: string, entry: Entry) => Read<Item>,
): Read<readonly Item[]> {
  const reads: Item[] = [];
  for (const [name, entry] of Object.entries(entries)) {
    const reading = read(name, entry);
    if (reading.kind === 'refused') {
      return reading;
    }
    reads.push(reading.value);
  }
  return { kind: 'read', value: reads };
}

function readStream(
  prefix: string | null,
  name: string,
  stream: BrokerPlanStream,
): Read<ReadStream> {
  const at: Path = ['streams', name];
  const key = readText(streamName, prefix, { at, text: name });
  if (key.kind === 'refused') {
    return key;
  }
  const service = readText(serviceName, prefix, { at: [...at, 'service'], text: stream.service });
  if (service.kind === 'refused') {
    return service;
  }
  const subjects: ReadSubject[] = [];
  for (const [index, text] of stream.subjects.entries()) {
    const reading = readText(subject, prefix, { at: [...at, 'subjects', index], text });
    if (reading.kind === 'refused') {
      return reading;
    }
    subjects.push(reading.value);
  }
  return { kind: 'read', value: { service: service.value, subjects } };
}

function readDurableConsumer(
  prefix: string | null,
  name: string,
  durableConsumer: BrokerPlanDurableConsumer,
): Read<ReadDurableConsumer> {
  const at: Path = ['durableConsumers', name];
  const key = readText(durableConsumerName, prefix, { at, text: name });
  const service = readText(serviceName, prefix, {
    at: [...at, 'service'],
    text: durableConsumer.service,
  });
  const stream = readText(streamName, prefix, {
    at: [...at, 'stream'],
    text: durableConsumer.stream,
  });
  const filter = readText(subject, prefix, {
    at: [...at, 'subject'],
    text: durableConsumer.subject,
  });
  if (key.kind === 'refused') {
    return key;
  }
  if (service.kind === 'refused') {
    return service;
  }
  if (stream.kind === 'refused') {
    return stream;
  }
  if (filter.kind === 'refused') {
    return filter;
  }
  const { consumed } = key.value;
  return { kind: 'read', value: { service: service.value, consumed, subject: filter.value } };
}
