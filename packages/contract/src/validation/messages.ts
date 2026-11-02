import {
  eventVisibilities,
  isMessageVersion,
  lifecycleOf,
  messageBodySentence,
  messageVersionSentence,
} from '../declarations/index.ts';
import { type DefGraph, defGraphOf, inFields, type SchemaNode } from '../walker/index.ts';
import {
  type Declarations,
  isWithoutValue,
  type LocatedCommand,
  type LocatedEvent,
  messageIdentityOf,
  slotAt,
  writtenTextOf,
} from '../written/index.ts';
import { type ClosedValue, closedValueFailures, lifecycle } from './closed-values.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import { repeated } from './names.ts';
import type { Nodes } from './schemas.ts';

/** An Event's or a Command's Message Version where it sits, read the same for both kinds. */
type LocatedMessage = {
  readonly at: LocatedEvent['at'];
  readonly message: LocatedEvent['event'] | LocatedCommand['command'];
};

/** The declared Events and Commands, each with where it sits. */
function locatedMessagesOf({ events, commands }: Declarations): {
  readonly events: readonly LocatedMessage[];
  readonly commands: readonly LocatedMessage[];
} {
  return {
    events: events.map(({ at, event }) => ({ at, message: event })),
    commands: commands.map(({ at, command }) => ({ at, message: command })),
  };
}

const eventVisibility: ClosedValue = {
  rule: 'visibility',
  allowed: eventVisibilities,
  noun: "An Event's Visibility",
};

/** The rules of the declared Message Versions, judged without the Baseline's tombstones. */
export function messageFailures(declarations: Declarations): readonly DeclarationFailure[] {
  const { events, commands } = locatedMessagesOf(declarations);
  const messages = [...events, ...commands];
  return [
    ...messages.flatMap(versionFailures),
    ...declarations.events.flatMap(({ at, event }) =>
      closedValueFailures(
        { at: inFields(at, 'visibility'), value: event.visibility },
        eventVisibility,
      ),
    ),
    ...messages.flatMap(({ at, message }) =>
      closedValueFailures({ at: inFields(at, 'lifecycle'), value: message.lifecycle }, lifecycle),
    ),
    ...identityFailures(events),
    ...identityFailures(commands),
    ...kindFailures(events, commands),
    ...activeCommandFailures(commands),
  ];
}

/** A Message body is an object of its fields, judged on the walked node, so a Message can grow. */
export function messageBodyFailures(
  declarations: Declarations,
  { nodeOf, defs }: Nodes,
): readonly DeclarationFailure[] {
  const { events, commands } = locatedMessagesOf(declarations);
  const located = [...events, ...commands];
  const graph = defGraphOf(defs);
  const notObjects = located.filter(({ message }) => {
    const body = nodeOf(message, 'body');
    return body !== undefined && !isObjectOf(body, graph);
  });
  return notObjects.map((message) =>
    failure(
      slotAt(message.at, 'body'),
      'not-an-object-schema',
      `${messageBodySentence}: ${identityOf(message)}`,
    ),
  );
}

/** Whether a node is an object, a `ref` read through its def and any alias defs; a nullable one is not. */
function isObjectOf(node: SchemaNode, graph: DefGraph): boolean {
  if (node.type !== 'ref') {
    return node.type === 'object' && node.nullable !== true;
  }
  const resolved = graph.resolved(node);
  return (
    resolved !== undefined &&
    !resolved.nullable &&
    resolved.def.type === 'object' &&
    resolved.def.nullable !== true
  );
}

function versionFailures({ at, message }: LocatedMessage): readonly DeclarationFailure[] {
  const { version } = message;
  if (isWithoutValue(version) || isMessageVersion(version)) {
    return [];
  }
  const text = `${messageVersionSentence}: ${writtenTextOf(version)}`;
  return [failure(inFields(at, 'version'), 'message-version', text)];
}

/** Whether a Message Version is named by a string; any other name already fails as a field. */
function isNamed({ message }: LocatedMessage): boolean {
  return typeof message.name === 'string';
}

/** Whether a Message Version's identity names it; any other name or version already fails as a field. */
function isIdentified(located: LocatedMessage): boolean {
  return isNamed(located) && typeof located.message.version === 'number';
}

function identityOf({ message }: LocatedMessage): string {
  return messageIdentityOf(message.name, message.version);
}

function identityFailures(messages: readonly LocatedMessage[]): readonly DeclarationFailure[] {
  return repeated(messages.filter(isIdentified), identityOf).map((located) =>
    failure(
      inFields(located.at, 'version'),
      'duplicate-message-identity',
      `A Message Version is identified by its name and version, once: ${identityOf(located)}`,
    ),
  );
}

/** A name an Event declares fails on the first Command that declares it too. */
function kindFailures(
  events: readonly LocatedMessage[],
  commands: readonly LocatedMessage[],
): readonly DeclarationFailure[] {
  const nameOf = ({ message }: LocatedMessage) => message.name;
  const eventNames = new Set(events.filter(isNamed).map(nameOf));
  const shared = commands.filter((located) => isNamed(located) && eventNames.has(nameOf(located)));
  const repeats = new Set(repeated(shared, nameOf));
  const firsts = shared.filter((located) => !repeats.has(located));
  return firsts.map(({ at, message }) =>
    failure(
      inFields(at, 'name'),
      'message-kind',
      `A Message name belongs to one kind: ${message.name} is an Event and a Command`,
    ),
  );
}

/** Every Active version of a Command after its first fails; a repeated identity is one version. */
function activeCommandFailures(commands: readonly LocatedMessage[]): readonly DeclarationFailure[] {
  const identified = commands.filter(isIdentified);
  const active = identified.filter(({ message }) => lifecycleOf(message) === 'active');
  const repeatedIdentities = new Set(repeated(active, identityOf));
  const versions = active.filter((located) => !repeatedIdentities.has(located));
  return repeated(versions, ({ message }) => message.name).map(({ at, message }) =>
    failure(
      inFields(at, 'lifecycle'),
      'command-active-versions',
      `A Command has at most one Active version: ${message.name}`,
    ),
  );
}
