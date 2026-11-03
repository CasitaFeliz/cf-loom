import type { FormerInput, InputSnapshot } from '../snapshot/index.ts';
import { type Defs, defGraphOf } from '../walker/index.ts';
import { builtGraftOf } from './graft-build.ts';
import { defNamesOf } from './graft-names.ts';
import { type GraftRoots, graftRecordOf } from './graft-record.ts';

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
  const record = graftRecordOf(rootsOf(former.input, onto.input), defs);
  if (record.grafting.length === 0) {
    return undefined;
  }
  const built = builtGraftOf(record, defNamesOf(record, onto.defs));
  if (built.query.type !== 'object') {
    throw new Error('A query grafted into no object: a bug.');
  }
  const input = { query: built.query, body: built.body ?? onto.input.body };
  const nodes = [input.query, input.body].filter((node) => node !== null);
  const { held } = defGraphOf(onto.defs).reached([...nodes, ...built.out.values()]);
  return { input, defs: { ...held, ...Object.fromEntries(built.out) } };
}

/** The pairs the graft walks: the query, and the body when the Former Input and the Endpoint both have one. */
function rootsOf(former: GraftSource['input'], onto: GraftTarget['input']): GraftRoots {
  const query = { baseline: former.query, proposed: onto.query };
  if (former.body === null || onto.body === null) {
    return { query, body: undefined };
  }
  return { query, body: { baseline: former.body, proposed: onto.body } };
}
