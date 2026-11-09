import {
  type DefScope,
  declaredCodesOf,
  defScopesOf,
  type PublishedSnapshot,
  reachedGuardNamesOf,
} from '../snapshot/index.ts';
import type { Problem } from '../validation/index.ts';
import { defGraphOf, type Path } from '../walker/index.ts';
import { type Use, usesOf } from './uses.ts';

const unused = {
  group: 'is a Group no declared Element or Subscription names',
  def: 'is a def no ref reaches from outside the defs',
  guard:
    'is a Guard no Endpoint attaches and no export names, directly or through the Guards they list',
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
  const groups = snapshot.kind === 'service' ? Object.keys(snapshot.groups) : [];
  const guards = Object.keys(snapshot.guards);
  const codes = declaredCodesOf(snapshot.codes).map(([code]) => code);
  const usedGuards = reachedGuardNamesOf(attachedOrExportedOf(uses), snapshot.guards);
  return [
    ...unusedIn({ at: ['groups'], names: groups, reason: unused.group }, namesOf(uses, ['group'])),
    ...defScopesOf(snapshot).flatMap(unusedDefProblemsOf),
    ...unusedIn({ at: ['guards'], names: guards, reason: unused.guard }, usedGuards),
    ...unusedIn(
      { at: ['codes'], names: codes, reason: unused.code },
      namesOf(uses, ['code', 'standard-code']),
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

/** The Guards an Endpoint attaches or an export names, which the Guards they list build on. */
function attachedOrExportedOf(uses: readonly Use[]): readonly string[] {
  const roots = uses.filter((use) => use.kind === 'guard' && use.at[0] !== 'guards');
  return roots.map(({ name }) => name);
}

/** The defs of a scope that no node outside them reaches. */
function unusedDefProblemsOf(scope: DefScope): readonly Problem[] {
  const outside = scope.nodes.filter(({ at }) => !isWithin(at, scope.at));
  const roots = outside.map(({ node }) => node);
  const reached = new Set(Object.keys(defGraphOf(scope.defs).reached(roots).held));
  return unusedIn({ at: scope.at, names: Object.keys(scope.defs), reason: unused.def }, reached);
}

function isWithin(at: Path, prefix: Path): boolean {
  return prefix.every((key, index) => at[index] === key);
}
