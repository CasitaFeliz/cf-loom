import { eventVisibilities, isMessageVersion, lifecycleOf } from '../declarations/index.ts';
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
  if (isWithoutValue(version) || isMessageVersion(version)) {
    return [];
  }
  const text = `A Message version is a whole number from 1: ${textOf(version)}`;
  return [failure([...at, 'version'], 'message-version', text)];
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
  const nameOf = ({ message }: LocatedMessage) => message.name;
  const eventNames = new Set(events.filter(isNamed).map(nameOf));
  const shared = commands.filter((located) => isNamed(located) && eventNames.has(nameOf(located)));
  const repeats = new Set(repeated(shared, nameOf));
  const firsts = shared.filter((located) => !repeats.has(located));
  return firsts.map(({ at, message }) =>
    failure(
      [...at, 'name'],
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
      [...at, 'lifecycle'],
      'command-active-versions',
      `A Command has at most one Active version: ${message.name}`,
    ),
  );
}
