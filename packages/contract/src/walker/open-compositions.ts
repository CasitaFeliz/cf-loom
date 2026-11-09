import { childrenOf, refsWrittenIn } from './children.ts';
import { defGraphOf } from './def-graph.ts';
import type { AllOfNodeOf, NotAllowed, UnionNodeOf } from './nodes.ts';
import { type Refused, refused } from './not-allowed.ts';
import type { Composition, JudgedDefs, Outline, Reached } from './walked.ts';

/**
 * Every `allOf` or `union` the walk built that reaches an Open Enum, at any depth: a reader of an
 * intersection merges what each item read, and a reader of a union takes the first option that
 * parses, and neither can tell an Unknown case from a value another part declares. Each is
 * judged where the walk built it, a def's at every place the walk met the def; whether a def
 * reaches one is answered once for the defs.
 */
export function openCompositionsOf(
  compositions: readonly Composition[],
  defs: JudgedDefs,
): readonly NotAllowed[] {
  const holding = defGraphOf(defs).closureFacts<OpenEnumFact>((_name, def) =>
    def !== undefined && holdsOpenEnum(def) ? [openEnumFact] : [],
  );
  const reachesOpen = ({ node }: Composition): boolean =>
    holdsOpenEnum(node) ||
    refsWrittenIn(node).some((name) => holding.get(name)?.has(openEnumFact) === true);
  return compositions.filter(reachesOpen).map(({ refusal }) => refusal);
}

/** What a def holds, in its own nodes or a def it reaches, that a composition reaching it answers for. */
type OpenEnumFact = 'holds an Open Enum';

const openEnumFact: OpenEnumFact = 'holds an Open Enum';

/** A composition the walk built where it stands, with the refusal it is if it reaches an Open Enum. */
export function compositionOf(
  at: Reached,
  node: AllOfNodeOf<Outline> | UnionNodeOf<Outline>,
): Composition {
  return { refusal: { kind: 'not-allowed', ...at, ...refusalOf(node) }, node };
}

function refusalOf(composition: Composition['node']): Refused {
  return composition.type === 'allOf' ? refused.openIntersection : refused.openUnion;
}

/** Whether a node holds an Open Enum inside it alone, with no def entered. */
function holdsOpenEnum(node: Outline): boolean {
  const pending: Outline[] = [node];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (next.type === 'enum' && next.open) {
      return true;
    }
    for (const child of childrenOf(next)) {
      pending.push(child.node);
    }
  }
  return false;
}
