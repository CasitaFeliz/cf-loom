import type { ModelMessage, ModelSubscription, ServiceModel } from './broker-plans.ts';

/** The most characters a name that reaches a Broker has, which the grammars bound. */
export const longestName = 64;

const lowerCase = 'abcdefghijklmnopqrstuvwxyz';
const upperCase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const lowerCaseAndDigits = `${lowerCase}0123456789`;

type Next = () => number;

/** The grammar a drawn name follows: kebab-case, camelCase words or PascalCase words. */
export type NameKind = 'kebab' | 'camel' | 'pascal';

function charsOf(next: Next, alphabet: string, count: number): string {
  return Array.from({ length: count }, () =>
    alphabet.charAt(Math.floor(next() * alphabet.length)),
  ).join('');
}

function leadOf(next: Next, kind: NameKind, isFirst: boolean): string {
  if (kind === 'kebab') {
    return charsOf(next, lowerCaseAndDigits, 1);
  }
  return charsOf(next, kind === 'camel' && isFirst ? lowerCase : upperCase, 1);
}

function minimumWordOf(kind: NameKind, isFirst: boolean): number {
  return kind === 'kebab' || (kind === 'camel' && isFirst) ? 1 : 2;
}

/** A name of the grammar of exactly `length` characters, or the shortest the grammar allows when that is more. */
export function nameOf(next: Next, kind: NameKind, length: number): string {
  const words: string[] = [];
  let used = 0;
  while (used < length || words.length === 0) {
    const isFirst = words.length === 0;
    const separator = kind === 'kebab' && !isFirst ? 1 : 0;
    const room = length - used - separator;
    const minimum = minimumWordOf(kind, isFirst);
    if (room < minimum && !isFirst) {
      break;
    }
    const size = Math.max(minimum, Math.min(room, 2 + Math.floor(next() * 7)));
    words.push(`${leadOf(next, kind, isFirst)}${charsOf(next, lowerCaseAndDigits, size - 1)}`);
    used += separator + size;
  }
  const padding = charsOf(next, lowerCaseAndDigits, Math.max(0, length - used));
  return `${words.join(kind === 'kebab' ? '-' : '')}${padding}`;
}

/** A length of a name: the longest one in a fifth of the draws, so every bound is met. */
function lengthOf(next: Next): number {
  return next() < 0.2 ? longestName : 1 + Math.floor(next() * 24);
}

/** A name of the grammar, of any length up to the longest. */
export function drawnName(next: Next, kind: NameKind): string {
  return nameOf(next, kind, lengthOf(next));
}

/** A Broker prefix: none in three draws of ten, else a kebab-case name. */
export function drawnPrefix(next: Next): string | null {
  return next() < 0.3 ? null : drawnName(next, 'kebab');
}

/** A version from 1 to the largest a Message Version may be. */
export function drawnVersion(next: Next): number {
  const kind = next();
  if (kind < 0.7) {
    return 1 + Math.floor(next() * 5);
  }
  return kind < 0.9 ? 1 + Math.floor(next() * Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
}

function countOf(next: Next, most: number): number {
  return Math.floor(next() * (most + 1));
}

function distinctVersionsOf(next: Next, count: number): readonly number[] {
  const versions = new Set<number>();
  while (versions.size < count) {
    versions.add(drawnVersion(next));
  }
  return [...versions];
}

function lifecycleOf(next: Next): ModelMessage['lifecycle'] {
  const draw = next();
  if (draw < 0.6) {
    return 'active';
  }
  return draw < 0.8 ? 'deprecated' : 'retired';
}

/** The Versions of some Messages of one kind, their names not among `used`: a Command has one Active Version at most. */
function drawnMessages(next: Next, kind: 'event' | 'command', used: Set<string>): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (let name = 0; name < countOf(next, 3); name += 1) {
    const messageName = drawnName(next, 'pascal');
    if (used.has(messageName)) {
      continue;
    }
    used.add(messageName);
    const versions = distinctVersionsOf(next, 1 + countOf(next, 2));
    const active = Math.floor(next() * (versions.length + 1));
    for (const [index, version] of versions.entries()) {
      const drawn = lifecycleOf(next);
      const lifecycle = kind === 'event' ? drawn : lifecycleOfCommand(drawn, index === active);
      messages.push({ name: messageName, version, lifecycle });
    }
  }
  return messages;
}

function lifecycleOfCommand(
  drawn: ModelMessage['lifecycle'],
  isActive: boolean,
): ModelMessage['lifecycle'] {
  if (isActive) {
    return 'active';
  }
  return drawn === 'active' ? 'deprecated' : drawn;
}

type Provider = {
  readonly name: string;
  readonly events: readonly { readonly name: string; readonly version: number }[];
};

function drawnProviders(next: Next, service: string): readonly Provider[] {
  const providers: Provider[] = [];
  for (let index = 0; index < countOf(next, 2); index += 1) {
    const name = drawnName(next, 'kebab');
    const names = [drawnName(next, 'pascal'), drawnName(next, 'pascal')];
    const events = names.map((eventName) => ({ name: eventName, version: drawnVersion(next) }));
    if (name !== service && !providers.some((provider) => provider.name === name)) {
      providers.push({ name, events });
    }
  }
  return providers;
}

type Received = Pick<ModelSubscription, 'provider' | 'event'>;

/** The Events a Subscription may receive: the Service's own that are not Retired, and every Provider's. */
function receivableOf(own: readonly ModelMessage[], providers: readonly Provider[]): Received[] {
  const ownEvents = own
    .filter((event) => event.lifecycle !== 'retired')
    .map((event) => ({ provider: undefined, event }));
  const foreign = providers.flatMap(({ name, events }) =>
    events.map((event) => ({ provider: name, event })),
  );
  return [...ownEvents, ...foreign];
}

function drawnSubscriptions(next: Next, receivable: readonly Received[]): ModelSubscription[] {
  const subscriptions: ModelSubscription[] = [];
  const names = new Set<string>();
  for (let index = 0; index < countOf(next, 3); index += 1) {
    const received = receivable[Math.floor(next() * receivable.length)];
    const name = drawnName(next, 'camel');
    if (received !== undefined && !names.has(name)) {
      names.add(name);
      subscriptions.push({
        name,
        provider: received.provider,
        event: { name: received.event.name, version: received.event.version },
      });
    }
  }
  return subscriptions;
}

/** A Service as an author could declare one: Messages in every lifecycle, Subscriptions to its own Events and to Providers'. */
export function drawnModel(next: Next): ServiceModel {
  const service = drawnName(next, 'kebab');
  const used = new Set<string>();
  const events = drawnMessages(next, 'event', used);
  const commands = drawnMessages(next, 'command', used);
  const providers = drawnProviders(next, service);
  const subscriptions = drawnSubscriptions(next, receivableOf(events, providers));
  return { service, events, commands, subscriptions };
}
