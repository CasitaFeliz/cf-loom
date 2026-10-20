import { messageIdentityOf } from '@cf-loom/contract/internal';
import { type BuiltProject, type BuiltService, snapshotFile } from '../project/index.ts';
import {
  deprecationStampsOf,
  handledOf,
  handlerMapFile,
  handlerMapTextOf,
  type RootLists,
  readersFile,
  readersTextOf,
} from '../service-code/index.ts';
import type { GeneratedFile } from '../writing/index.ts';

/** `contract.snapshot.json`, which every root regenerates. */
export function snapshotFileOf(built: BuiltProject): GeneratedFile {
  return { path: snapshotFile, text: built.bytes, written: 'always' };
}

/** The files a Service regenerates beside its Snapshot, or the line saying which name cannot be written as code. */
export type ServiceFiles =
  | { readonly kind: 'files'; readonly files: readonly GeneratedFile[] }
  | { readonly kind: 'unnamed'; readonly line: string };

/** The files a Service regenerates beside its Snapshot: its Handler map and its readers. */
export function serviceFilesOf(service: BuiltService): ServiceFiles {
  const readers = readersTextOf(service.snapshot, rootListsOf(service));
  if (readers.kind === 'unnamed') {
    return readers;
  }
  const handled = handledOf(service.snapshot);
  const stamps = deprecationStampsOf(service.snapshot);
  const files: readonly GeneratedFile[] = [
    { path: handlerMapFile, text: handlerMapTextOf(handled, stamps), written: 'always' },
    { path: readersFile, text: readers.text, written: 'always' },
  ];
  return { kind: 'files', files };
}

/**
 * Where the valid root lists its Commands' Message Versions and Subscriptions, each Subscription
 * with the Service's own Event it receives, as its validated Service says.
 */
function rootListsOf({ validated, snapshot }: BuiltService): RootLists {
  const { commands, subscriptions } = validated.declarations;
  const commandEntries = commands.map(
    ({ command }, position) =>
      [messageIdentityOf(command.name, command.version), position] as const,
  );
  const subscriptionEntries = subscriptions.map(({ subscription, service }, position) => {
    const { name, version } = subscription.event;
    const receives =
      service === snapshot.name
        ? ({ kind: 'own', event: { name, version } } as const)
        : ({ kind: 'dependency' } as const);
    return [subscription.name, { position, receives }] as const;
  });
  return { commands: new Map(commandEntries), subscriptions: new Map(subscriptionEntries) };
}
