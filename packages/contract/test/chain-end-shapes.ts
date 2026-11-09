import type { ObjectNode, SchemaNode } from '../src/internal/index.ts';
import {
  aChainOfObjects,
  anObject,
  aRef,
  aServiceOf,
  aString,
  endpointsOf,
  optional,
  publishedFirst,
  required,
  type Shape,
} from './graft-fixtures.ts';

/** What changes at the end of a chain of object defs, no field removed that a Former Input could put back. */
export type ChainEnd =
  | 'description'
  | 'gained field'
  | 'retyped field'
  | 'union option'
  | 'retargeted refs';

/** The end of the chain, `c0`, as the Baseline holds it or as the proposed Snapshot does. */
function endOf(change: ChainEnd, isProposed: boolean): SchemaNode {
  const end = aChainOfObjects(1)['c0'] as ObjectNode;
  switch (change) {
    case 'description':
      return { ...end, description: isProposed ? 'new' : 'old' };
    case 'gained field':
      return isProposed ? { ...end, fields: { ...end.fields, more: optional(aString) } } : end;
    case 'retyped field':
      return isProposed ? anObject({ next: required({ type: 'number' }) }) : end;
    case 'union option': {
      const lost = isProposed ? {} : { b: optional(aString) };
      const options = [anObject({ a: required(aString), ...lost }), aString];
      return anObject({ next: required(aString), u: required({ type: 'union', options }) });
    }
    case 'retargeted refs':
      return end;
  }
}

/** `count` Endpoints whose Input body names the top of the chain `names` gives, over the chain's defs. */
function endpointsOverChain(count: number, top: string, end: SchemaNode) {
  const chain = { ...aChainOfObjects(count), c0: end };
  return aServiceOf(
    endpointsOf(count, () => anObject({ x: required(aRef(top)) })),
    chain,
  );
}

/** `count` Endpoints naming the top of a chain of `count` object defs, where the proposed Snapshot names the top of a chain of the same shape under other names. */
function retargetedChainOf(count: number): Shape {
  const renamed = Object.fromEntries(
    Array.from({ length: count }, (_, index): [string, SchemaNode] => [
      `d${index}`,
      anObject({ next: required(index === 0 ? aString : aRef(`d${index - 1}`)) }),
    ]),
  );
  const proposed = aServiceOf(
    endpointsOf(count, () => anObject({ x: required(aRef(`d${count - 1}`)) })),
    renamed,
  );
  return {
    baseline: publishedFirst(
      endpointsOverChain(count, `c${count - 1}`, endOf('retargeted refs', false)),
    ),
    proposed,
  };
}

/**
 * `count` Endpoints whose Input body names the top of one chain of `count` object defs, whose end
 * changed as given, so the chain's closure changed and nothing in it can be put back as a field.
 */
export function endpointsNamingOneChainChangedAt(count: number, change: ChainEnd): Shape {
  if (change === 'retargeted refs') {
    return retargetedChainOf(count);
  }
  const top = `c${count - 1}`;
  const baseline = endpointsOverChain(count, top, endOf(change, false));
  return {
    baseline: publishedFirst(baseline),
    proposed: endpointsOverChain(count, top, endOf(change, true)),
  };
}
