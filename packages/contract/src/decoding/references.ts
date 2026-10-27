import {
  type PublishedApplicationSnapshot,
  type PublishedSnapshot,
  removedCodesOf,
} from '../snapshot/index.ts';
import type { Problem } from '../validation/index.ts';
import { leadsBackWithNoNode, type Path, type SchemaNode } from '../walker/index.ts';
import { readEndpointIdentity, readEventReference, readMessageIdentity } from '../written/index.ts';
import { paramProblemsOf } from './params.ts';
import {
  codeStatusProblemsOf,
  standardBodyProblemsOf,
  standardHeaderProblemsOf,
} from './standard-codes.ts';
import { notEndpointIdentity } from './texts.ts';
import { type Use, usesOf } from './uses.ts';

/** A text a Snapshot holds, and where. */
type Located = { readonly at: Path; readonly text: string };

/**
 * The first identity a Snapshot holds that is none, an Endpoint's params that are not its
 * identity's, a name it uses and does not hold (a `ref`'s def, a code an Endpoint or Guard lists
 * or a Standard Rejection names, or a Guard), a Standard Rejection's code with a body it does not
 * have or with headers, a code's status no Rejection has, or a def that leads back to itself with
 * no node between; `undefined` when there is none.
 */
export function heldProblemOf(snapshot: PublishedSnapshot): Problem | undefined {
  return [
    ...identityProblemsOf(snapshot),
    ...paramProblemsOf(snapshot),
    ...unheldProblemsOf(snapshot),
    ...standardBodyProblemsOf(snapshot),
    ...standardHeaderProblemsOf(snapshot),
    ...codeStatusProblemsOf(snapshot),
    ...nodelessCycleProblemsOf(snapshot),
  ][0];
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
  reason: notEndpointIdentity,
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
  return unreadable(ids, endpointIdentity);
}

const unheld = {
  def: 'names a def the Snapshot does not hold',
  code: 'lists a code the Snapshot does not hold',
  'standard-code': 'names a code the Snapshot does not hold',
  guard: 'names a Guard the Snapshot does not hold',
  group: 'names a Group the Snapshot does not hold',
} as const;

/** The defs a Snapshot holds, with where they sit: its own, and each removed code's. */
type DefsAt = { readonly at: Path; readonly defs: ReadonlyMap<string, SchemaNode> };

function defsHeldBy(snapshot: Exclude<PublishedSnapshot, { kind: 'application' }>): DefsAt[] {
  const removed = removedCodesOf(snapshot.codes).map(([code, held]) => ({
    at: ['codes', code, 'defs'],
    defs: new Map(Object.entries(held.defs)),
  }));
  return [{ at: ['defs'], defs: new Map(Object.entries(snapshot.defs)) }, ...removed];
}

function nodelessCycleProblemsOf(snapshot: PublishedSnapshot): readonly Problem[] {
  if (snapshot.kind === 'application') {
    return [];
  }
  const problems: Problem[] = [];
  for (const { at, defs } of defsHeldBy(snapshot)) {
    for (const [name, def] of defs) {
      if (leadsBackWithNoNode(name, def, defs)) {
        problems.push({
          at: [...at, name],
          reason: 'leads back to itself through refs, unions and allOfs alone',
        });
      }
    }
  }
  return problems;
}

function unheldProblemsOf(snapshot: PublishedSnapshot): readonly Problem[] {
  if (snapshot.kind === 'application') {
    return [];
  }
  const held = {
    code: snapshot.codes,
    'standard-code': snapshot.codes,
    guard: snapshot.guards,
    group: snapshot.kind === 'service' ? snapshot.groups : {},
  };
  const missing = usesOf(snapshot).filter((use) => !holds(use, held));
  return missing.map(({ kind, name, at }) => ({ at, reason: `${unheld[kind]}: ${name}` }));
}

/** Whether the names a use resolves in hold it: a `ref`'s own defs, else the Snapshot's map of its kind. */
function holds(use: Use, held: Record<Exclude<Use['kind'], 'def'>, object>): boolean {
  const names = use.kind === 'def' ? use.defs : held[use.kind];
  return Object.hasOwn(names, use.name);
}
