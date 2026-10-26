import type { LocatedGroup } from '../written/index.ts';
import type { GroupSnapshot } from './types.ts';

/** Every Group by name with its description, which an Element's `group` names. */
export function groupSnapshotsOf(
  groups: readonly LocatedGroup[],
): Readonly<Record<string, GroupSnapshot>> {
  const entries = groups.map(({ group }) => [group.name, { description: group.description }]);
  return Object.fromEntries(entries);
}
