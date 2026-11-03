import type { Defs, SchemaNode } from '../src/internal/index.ts';
import {
  anEndpointOf,
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

/** How a chain of alias defs differs between the Baseline and the proposed Snapshot. */
type Chain = { readonly description: (index: number) => string; readonly isLost: boolean };

/** `count` defs `a0`, `a1`…, the first an object of `leaf` and, unless `isLost`, the optional `gone`, each other an alias of the one before, described as given. */
function aliasChainOf(count: number, { description, isLost }: Chain): Defs {
  const fields = { leaf: required(aString), ...(isLost ? {} : { gone: optional(aString) }) };
  const aliases = Array.from({ length: count - 1 }, (_, index): [string, SchemaNode] => [
    `a${index + 1}`,
    { ...aRef(`a${index}`), description: description(index + 1) },
  ]);
  return { a0: anObject(fields), ...Object.fromEntries(aliases) };
}

/** `count` Endpoints whose Input body names the top of one chain of `count` alias defs whose end loses a field. */
export function endpointsNamingAnAliasChainLosingField(count: number): Shape {
  const body = anObject({ x: required(aRef(`a${count - 1}`)) });
  const sideOf = (isLost: boolean) =>
    aServiceOf(
      endpointsOf(count, () => body),
      aliasChainOf(count, { description: () => 'same', isLost }),
    );
  return { baseline: publishedFirst(sideOf(false)), proposed: sideOf(true) };
}

/** `count` Endpoints whose Input body names the top of one chain of `count` alias defs, each alias def's description changed. */
export function endpointsNamingChangedAliasDefs(count: number): Shape {
  const body = anObject({ x: required(aRef(`a${count - 1}`)) });
  const sideOf = (description: string) =>
    aServiceOf(
      endpointsOf(count, () => body),
      aliasChainOf(count, { description: () => description, isLost: true }),
    );
  return { baseline: publishedFirst(sideOf('old')), proposed: sideOf('new') };
}

/** One Endpoint whose Input body holds `count` fields, each naming one alias def of a chain of `count`, each alias def's description changed. */
export function fieldsNamingChangedAliasDefs(count: number): Shape {
  const fields = Object.fromEntries(
    Array.from({ length: count }, (_, index) => [`f${index}`, required(aRef(`a${index}`))]),
  );
  const sideOf = (description: string) =>
    aServiceOf(
      { 'PUT /e': anEndpointOf(anObject(fields)) },
      aliasChainOf(count, { description: () => description, isLost: true }),
    );
  return { baseline: publishedFirst(sideOf('old')), proposed: sideOf('new') };
}

/**
 * `count` Endpoints whose Input body names an alias def that leads, through another alias def, to
 * one object of `count` fields, where the proposed Snapshot names another alias def of that object,
 * one alias def away from it or two.
 */
export function endpointsNamingAnotherAliasOfOneDef(count: number, proposedAliases: 1 | 2): Shape {
  const fields = Object.fromEntries(
    Array.from({ length: count }, (_, index) => [`f${index}`, required(aString)]),
  );
  const sideOf = (top: string, defs: Defs) =>
    aServiceOf(
      endpointsOf(count, () => anObject({ x: required(aRef(top)) })),
      { wide: anObject(fields), ...defs },
    );
  const proposedDefs: Defs =
    proposedAliases === 2
      ? { other: aRef('another'), another: aRef('wide') }
      : { other: aRef('wide') };
  const baseline = sideOf('first', { first: aRef('second'), second: aRef('wide') });
  return { baseline: publishedFirst(baseline), proposed: sideOf('other', proposedDefs) };
}
