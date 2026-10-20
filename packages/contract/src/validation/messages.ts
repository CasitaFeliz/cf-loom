import { eventVisibilities } from '../declarations/index.ts';
import {
  type Declarations,
  isWithoutValue,
  type LocatedCommand,
  type LocatedEvent,
  messageIdentityOf,
  textOf,
} from '../written/index.ts';
import { type ClosedValue, closedValueFailures, lifecycle } from './closed-values.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import { repeated } from './names.ts';

/** An Event's or a Command's Message Version where it sits, read the same for both kinds. */
type LocatedMessage = {
  readonly at: LocatedEvent['at'];
  readonly message: LocatedEvent['event'] | LocatedCommand['command'];
};

const eventVisibility: ClosedValue = {
  rule: 'visibility',
  allowed: eventVisibilities,
  noun: "An Event's Visibility",
};

/** The rules of the declared Message Versions, judged without the Baseline's tombstones. */
export function messageFailures(declarations: Declarations): readonly DeclarationFailure[] {
  const events = declarations.events.map(({ at, event }) => ({ at, message: event }));
  const commands = declarations.commands.map(({ at, command }) => ({ at, message: command }));
  const messages = [...events, ...commands];
  return [
    ...messages.flatMap(versionFailures),
    ...declarations.events.flatMap(({ at, event }) =>
      closedValueFailures({ at: [...at, 'visibility'], value: event.visibility }, eventVisibility),
    ),
    ...messages.flatMap(({ at, message }) =>
      closedValueFailures({ at: [...at, 'lifecycle'], value: message.lifecycle }, lifecycle),
    ),
    ...identityFailures(events),
    ...identityFailures(commands),
    ...kindFailures(events, commands),
    ...activeCommandFailures(commands),
  ];
}

function versionFailures({ at, message }: LocatedMessage): readonly DeclarationFailure[] {
  const { version } = message;
  if (isWithoutValue(version) || (Number.isInteger(version) && version >= 1)) {
    return [];
  }
  const text = `A Message version is a whole number from 1: ${textOf(version)}`;
  return [failure([...at, 'version'], 'message-version', text)];
}

function identityFailures(messages: readonly LocatedMessage[]): readonly DeclarationFailure[] {
  const identityOf = ({ message }: LocatedMessage) =>
    messageIdentityOf(message.name, message.version);
  return repeated(messages, identityOf).map((located) =>
    failure(
      [...located.at, 'version'],
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
  const eventNames = new Set(events.map(({ message }) => textOf(message.name)));
  const nameOf = ({ message }: LocatedMessage) => textOf(message.name);
  const shared = commands.filter((located) => eventNames.has(nameOf(located)));
  const repeats = new Set(repeated(shared, nameOf));
  const firsts = shared.filter((located) => !repeats.has(located));
  return firsts.map(({ at, message }) =>
    failure(
      [...at, 'name'],
      'message-kind',
      `A Message name belongs to one kind: ${textOf(message.name)} is an Event and a Command`,
    ),
  );
}

/** Every Active version of a Command after its first fails. */
function activeCommandFailures(commands: readonly LocatedMessage[]): readonly DeclarationFailure[] {
  const active = commands.filter(({ message }) => (message.lifecycle ?? 'active') === 'active');
  return repeated(active, ({ message }) => textOf(message.name)).map(({ at, message }) =>
    failure(
      [...at, 'lifecycle'],
      'command-active-versions',
      `A Command has at most one Active version: ${textOf(message.name)}`,
    ),
  );
}
