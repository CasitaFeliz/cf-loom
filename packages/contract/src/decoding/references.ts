import type { PublishedApplicationSnapshot, PublishedSnapshot } from '../snapshot/index.ts';
import type { Path } from '../walker/index.ts';
import { readEndpointIdentity, readEventReference, readMessageIdentity } from '../written/index.ts';
import { usesOf } from './uses.ts';

/** One place where a Snapshot breaks what its format promises, and what it breaks. */
export type Problem = { readonly at: Path; readonly reason: string };

/** A text a Snapshot holds, and where. */
type Located = { readonly at: Path; readonly text: string };

/**
 * The first identity a Snapshot holds that is none, or name it uses and does not hold: a `ref`'s
 * def, a code an Endpoint or Guard lists, or a Guard; `undefined` when there is none.
 */
export function referenceProblemOf(snapshot: PublishedSnapshot): Problem | undefined {
  return [...identityProblemsOf(snapshot), ...unheldProblemsOf(snapshot)][0];
}

function identityProblemsOf(snapshot: PublishedSnapshot): readonly Problem[] {
  switch (snapshot.kind) {
    case 'service':
      return [
        ...unreadable(keysAt('endpoints', snapshot.endpoints), endpointIdentity),
        ...unreadable(keysAt('events', snapshot.events), messageIdentity),
        ...unreadable(keysAt('commands', snapshot.commands), messageIdentity),
        ...unreadable(eventsAt(snapshot.subscriptions), eventReference),
        ...dependencyProblems(snapshot.dependencies),
      ];
    case 'application':
      return dependencyProblems(snapshot.dependencies);
    case 'definitions':
      return [];
  }
}

/** A form of text a Snapshot holds, how to tell it, and what a text that is not one breaks. */
type Form = { readonly isForm: (text: string) => boolean; readonly reason: string };

const endpointIdentity: Form = {
  isForm: (text) => readEndpointIdentity(text) !== undefined,
  reason: 'is not an Endpoint’s identity: a method and a path with its params as {}',
};
const messageIdentity: Form = {
  isForm: (text) => readMessageIdentity(text) !== undefined,
  reason: 'is not a Message Version’s identity: a name, @ and a whole number from 1',
};
const eventReference: Form = {
  isForm: (text) => readEventReference(text) !== undefined,
  reason: 'is not a Service and the identity of one of its Events',
};

function unreadable(located: readonly Located[], form: Form): readonly Problem[] {
  const broken = located.filter(({ text }) => !form.isForm(text));
  return broken.map(({ at }) => ({ at, reason: form.reason }));
}

function keysAt(section: string, map: Readonly<Record<string, unknown>>): readonly Located[] {
  return Object.keys(map).map((key) => ({ at: [section, key], text: key }));
}

function eventsAt(
  subscriptions: Readonly<Record<string, { readonly event: string }>>,
): readonly Located[] {
  return Object.entries(subscriptions).map(([name, { event }]) => ({
    at: ['subscriptions', name, 'event'],
    text: event,
  }));
}

function dependencyProblems(
  dependencies: PublishedApplicationSnapshot['dependencies'],
): readonly Problem[] {
  const providers = Object.entries(dependencies);
  const ids = providers.flatMap(([provider, { endpoints }]) =>
    endpoints.map(({ id }, index) => ({
      at: ['dependencies', provider, 'endpoints', index, 'id'],
      text: id,
    })),
  );
  const events = providers.flatMap(([provider, dependency]) =>
    dependency.events.map((text, index) => ({
      at: ['dependencies', provider, 'events', index],
      text,
    })),
  );
  return [...unreadable(ids, endpointIdentity), ...unreadable(events, messageIdentity)];
}

const unheld = {
  def: 'names a def the Snapshot does not hold',
  code: 'lists a code the Snapshot does not hold',
  guard: 'names a Guard the Snapshot does not hold',
} as const;

function unheldProblemsOf(snapshot: PublishedSnapshot): readonly Problem[] {
  if (snapshot.kind === 'application') {
    return [];
  }
  const held = { def: snapshot.defs, code: snapshot.codes, guard: snapshot.guards };
  const missing = usesOf(snapshot).filter((use) => !Object.hasOwn(held[use.kind], use.name));
  return missing.map(({ kind, name, at }) => ({ at, reason: `${unheld[kind]}: ${name}` }));
}
