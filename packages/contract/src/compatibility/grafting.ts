import type { FormerInput, InputSnapshot } from '../snapshot/index.ts';
import { type Defs, defGraphOf, type SchemaNode } from '../walker/index.ts';
import { stepCopy } from './graft-copy.ts';
import { namedDefs, recordingDefs } from './graft-names.ts';
import { placePair, stepGraft } from './graft-pairs.ts';
import type { Walk } from './graft-walk.ts';

/** What a former Input is rewritten onto: an Endpoint's query and body as proposed, and the defs their `ref`s name. */
export type GraftTarget = {
  readonly input: Pick<InputSnapshot, 'query' | 'body'>;
  readonly defs: Defs;
};

/** A former Input to rewrite, with the defs it names: the Input as stored, or its Endpoint's own Input as the Baseline holds it. */
export type GraftSource = { readonly input: FormerInput['input']; readonly defs: Defs };

type Grafted = Pick<FormerInput, 'input' | 'defs'>;

/**
 * A former Input rewritten onto an Endpoint's query and body: the Endpoint's, with every field the
 * former Input has and they lack grafted in as it was, wherever the Input rules compare fields, and
 * the defs they reach, the Endpoint's under their names and the others named apart; `undefined`
 * when it grafts no field, so the former Input is forgotten.
 */
export function graftedInputOf(former: GraftSource, onto: GraftTarget): Grafted | undefined {
  const defs = { baseline: former.defs, proposed: onto.defs };
  const recorded = walked(former, onto.input, { defs, met: recordingDefs() });
  if (!recorded.grafts) {
    return undefined;
  }
  const options = { defs, met: namedDefs(recorded.met, onto.defs) };
  const named = walked(former, onto.input, options);
  const nodes = [named.input.query, named.input.body].filter((node) => node !== null);
  const { held } = defGraphOf(onto.defs).reached([...nodes, ...named.out.values()]);
  return { input: named.input, defs: { ...held, ...Object.fromEntries(named.out) } };
}

type Options = Pick<Walk, 'defs' | 'met'>;

function walked(former: GraftSource, onto: GraftTarget['input'], options: Options) {
  const walk: Walk = { ...options, out: new Map(), frames: [], grafts: false };
  const query = partGrafted(walk, former.input.query, onto.query);
  const body = partGrafted(walk, former.input.body, onto.body);
  if (query?.type !== 'object') {
    throw new Error('A query grafted into no object: a bug.');
  }
  const input = { query, body };
  return { input, out: walk.out, grafts: walk.grafts, met: walk.met };
}

function partGrafted<Part extends SchemaNode | null>(
  walk: Walk,
  former: SchemaNode | null,
  proposed: Part,
): Part | SchemaNode {
  if (former === null || proposed === null) {
    return proposed;
  }
  let built: SchemaNode = proposed;
  const put = (node: SchemaNode) => {
    built = node;
  };
  placePair(walk, { baseline: former, proposed }, { owner: undefined, put });
  runFrames(walk);
  return built;
}

/** Builds every frame on the stack, depth first, each put in its place once its findings are applied. */
function runFrames(walk: Walk): void {
  for (let frame = walk.frames.at(-1); frame !== undefined; frame = walk.frames.at(-1)) {
    if (frame.kind === 'graft') {
      stepGraft(walk, frame);
    } else {
      stepCopy(walk, frame);
    }
  }
}
