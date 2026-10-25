import { byCodePoint } from '@cf-loom/contract/internal';
import type { ExportsOf, FileExport } from '../loading/index.ts';
import type { BuiltService } from '../project/index.ts';
import {
  elementLabelOf,
  type MessageExports,
  type MessageHandled,
  pairingNameOf,
} from '../service-code/index.ts';
import { exportedAtOf, type Located } from './exported-declarations.ts';

/** A Command's Message Version or a Subscription, and where it is exported. */
type LocatedMessage = Located<FileExport> & { readonly handled: MessageHandled };

type ExportedMessage = Extract<LocatedMessage, { readonly kind: 'exported' }>;
type RefusedMessage = Extract<LocatedMessage, { readonly kind: 'refused' }>;

/**
 * Where the valid root's Commands' Message Versions, Retired ones included, and Subscriptions are
 * exported: Commands, then Subscriptions, each in code point order of its name in code.
 */
export function messageExportsOf(
  { validated }: BuiltService,
  exportsOf: ExportsOf,
): MessageExports {
  const { commands, subscriptions } = validated.declarations;
  const commandMessages = commands.map(({ command }) => {
    const handled = { kind: 'command', name: command.name, version: command.version } as const;
    return locatedMessageOf(handled, command, exportsOf);
  });
  const subscriptionMessages = subscriptions.map(({ subscription }) => {
    const handled = { kind: 'subscription', name: subscription.name } as const;
    return locatedMessageOf(handled, subscription, exportsOf);
  });
  const located = [...commandMessages.sort(byName), ...subscriptionMessages.sort(byName)];
  const lines = located.filter(isRefused).map(({ line }) => line);
  if (lines.length > 0) {
    return { kind: 'refused', lines };
  }
  const atByLabel = new Map(
    located.filter(isExported).map(({ handled, at }) => [elementLabelOf(handled), at]),
  );
  return { kind: 'located', atOf: (message) => atOf(atByLabel, message) };
}

function locatedMessageOf(
  handled: MessageHandled,
  declaration: unknown,
  exportsOf: ExportsOf,
): LocatedMessage {
  const label = elementLabelOf(handled);
  const located = exportedAtOf(label, exportsOf(declaration));
  return { ...located, handled };
}

function atOf(atByLabel: ReadonlyMap<string, FileExport>, message: MessageHandled): FileExport {
  const label = elementLabelOf(message);
  const at = atByLabel.get(label);
  if (at === undefined) {
    throw new Error(`The root declares no ${label}, which its Snapshot holds: a bug.`);
  }
  return at;
}

function byName(left: LocatedMessage, right: LocatedMessage): number {
  return byCodePoint(pairingNameOf(left.handled), pairingNameOf(right.handled));
}

function isExported(located: LocatedMessage): located is ExportedMessage {
  return located.kind === 'exported';
}

function isRefused(located: LocatedMessage): located is RefusedMessage {
  return located.kind === 'refused';
}
