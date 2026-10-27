import {
  type DefScope,
  declaredCodesOf,
  defScopesOf,
  type PublishedSnapshot,
} from '../snapshot/index.ts';
import type { Problem } from '../validation/index.ts';
import { type Path, reachedDefsOf } from '../walker/index.ts';
import { type Use, usesOf } from './uses.ts';

const unused = {
  group: 'is a Group no declared Element or Subscription names',
  def: 'is a def no ref reaches',
  guard: 'is a Guard no Endpoint attaches, no export names and no Guard it holds lists',
  code: 'is a code nothing answers or names, held without removedIn',
} as const;

/**
 * Each Group, def, Guard and live code a Snapshot holds and does not use, which `generate` never
 * writes and the Check would read as a Change.
 */
export function unusedProblemsOf(snapshot: PublishedSnapshot): readonly Problem[] {
  if (snapshot.kind === 'application') {
    return [];
  }
  const uses = usesOf(snapshot);
  const guards = usedGuardsOf(uses);
  const used = uses.filter((use) => isOutsideUnusedGuard(use, guards));
  const groups = snapshot.kind === 'service' ? Object.keys(snapshot.groups) : [];
  const codes = declaredCodesOf(snapshot.codes).map(([code]) => code);
  const guardNames = Object.keys(snapshot.guards);
  return [
    ...unusedIn({ at: ['groups'], names: groups, reason: unused.group }, namesOf(used, ['group'])),
    ...defScopesOf(snapshot).flatMap(unusedDefProblemsOf),
    ...unusedIn({ at: ['guards'], names: guardNames, reason: unused.guard }, guards),
    ...unusedIn(
      { at: ['codes'], names: codes, reason: unused.code },
      namesOf(used, ['code', 'standard-code']),
    ),
  ];
}

/** The names a Snapshot holds at one place, and why one it does not use is refused. */
type Held = { readonly at: Path; readonly names: readonly string[]; readonly reason: string };

function unusedIn({ at, names, reason }: Held, used: ReadonlySet<string>): readonly Problem[] {
  const unusedNames = names.filter((name) => !used.has(name));
  return unusedNames.map((name) => ({ at: [...at, name], reason }));
}

function namesOf(uses: readonly Use[], kinds: readonly Use['kind'][]): ReadonlySet<string> {
  const ofKinds = uses.filter((use) => kinds.includes(use.kind));
  return new Set(ofKinds.map(({ name }) => name));
}

/** The Guard a use sits in, which uses a name only while it is itself used; none for any other holder. */
function holderGuardOf({ at }: Use): string | undefined {
  return at[0] === 'guards' ? String(at[1]) : undefined;
}

function isOutsideUnusedGuard(use: Use, guards: ReadonlySet<string>): boolean {
  const holder = holderGuardOf(use);
  return holder === undefined || guards.has(holder);
}

/** The Guards an Endpoint attaches or an export names, and those they list, at any depth. */
function usedGuardsOf(uses: readonly Use[]): ReadonlySet<string> {
  const guardUses = uses.filter((use) => use.kind === 'guard');
  const roots = guardUses.filter((use) => holderGuardOf(use) === undefined);
  const pending = roots.map(({ name }) => name);
  const used = new Set<string>();
  for (let guard = pending.pop(); guard !== undefined; guard = pending.pop()) {
    if (used.has(guard)) {
      continue;
    }
    used.add(guard);
    const listed = guardUses.filter((use) => holderGuardOf(use) === guard);
    pending.push(...listed.map(({ name }) => name));
  }
  return used;
}

/** The defs of a scope that no node outside them reaches. */
function unusedDefProblemsOf(scope: DefScope): readonly Problem[] {
  const outside = scope.nodes.filter(({ at }) => !isWithin(at, scope.at));
  const roots = outside.map(({ node }) => node);
  const reached = new Set(reachedDefsOf(roots, scope.defs));
  return unusedIn({ at: scope.at, names: Object.keys(scope.defs), reason: unused.def }, reached);
}

function isWithin(at: Path, prefix: Path): boolean {
  return prefix.every((key, index) => at[index] === key);
}
