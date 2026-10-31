import type { Field, FormerInput, ObjectNode, SchemaNode } from '../src/internal/index.ts';
import {
  aChainOfAliases,
  aChainOfObjects,
  aCode,
  anEndpointOf,
  anObject,
  aRef,
  aServiceOf,
  aString,
  chainEndpointOf,
  emptyObject,
  endpointsOf,
  optional,
  publishedFirst,
  publishedHolding,
  required,
  type Shape,
} from './graft-fixtures.ts';

/** `count` Endpoints whose Input body names the head of one chain of `count` defs, nothing removed. */
export function endpointsNamingChain(count: number, naming: 'bare' | 'in a field'): Shape {
  const head = aRef(`c${count - 1}`);
  const body = naming === 'bare' ? head : anObject({ x: required(head) });
  const service = aServiceOf(
    endpointsOf(count, () => body),
    aChainOfObjects(count),
  );
  return { baseline: publishedFirst(service), proposed: structuredClone(service) };
}

function stringFields(count: number, skipped: number): Readonly<Record<string, Field>> {
  const names = Array.from({ length: count }, (_, index) => index).filter(
    (index) => index !== skipped,
  );
  return Object.fromEntries(names.map((index) => [`f${index}`, optional(aString)]));
}

/** One Endpoint whose Input body holds `count` fields, the first removed in the proposed Snapshot. */
export function wideBodyLosingField(count: number): Shape {
  const baseline = aServiceOf({ 'PUT /e': anEndpointOf(anObject(stringFields(count, -1))) }, {});
  const proposed = aServiceOf({ 'PUT /e': anEndpointOf(anObject(stringFields(count, 0))) }, {});
  return { baseline: publishedFirst(baseline), proposed };
}

/** One Endpoint whose Input body is the head of a chain of `count` defs, the first of which loses a field. */
export function chainLosingFieldAtEnd(count: number): Shape {
  const endpoint = anEndpointOf(aRef(`c${count - 1}`));
  const chain = aChainOfObjects(count);
  const first = anObject({ ...(chain['c0'] as ObjectNode).fields, gone: optional(aString) });
  const baseline = aServiceOf({ 'PUT /e': endpoint }, { ...chain, c0: first });
  return {
    baseline: publishedFirst(baseline),
    proposed: aServiceOf({ 'PUT /e': endpoint }, chain),
  };
}

/**
 * One Endpoint whose Input body names, in a field, the head of a chain of `count` defs that each
 * hold the top of one chain of `count` alias defs whose end changed its description, and loses a
 * field.
 */
export function defsNamingAnAliasChain(count: number): Shape {
  const holders = Array.from({ length: count }, (_, index): [string, SchemaNode] => {
    const previous = index === 0 ? {} : { next: required(aRef(`c${index - 1}`)) };
    return [`c${index}`, anObject({ a: required(aRef(`a${count - 1}`)), ...previous })];
  });
  const sideOf = (description: string, fields: Readonly<Record<string, Field>>) => {
    const defs = { ...aChainOfAliases(count, description), ...Object.fromEntries(holders) };
    return aServiceOf({ 'PUT /e': anEndpointOf(anObject(fields)) }, defs);
  };
  const head = optional(aRef(`c${count - 1}`));
  const baseline = sideOf('old', { f0: head, f1: optional(aString) });
  return { baseline: publishedFirst(baseline), proposed: sideOf('new', { f0: head }) };
}

/** `count` Endpoints whose Input body names, in a field, the top of one chain of `count` alias defs whose end changed its description. */
export function endpointsNamingAnAliasChain(count: number): Shape {
  const body = anObject({ x: required(aRef(`a${count - 1}`)) });
  const sideOf = (description: string) =>
    aServiceOf(
      endpointsOf(count, () => body),
      aChainOfAliases(count, description),
    );
  return { baseline: publishedFirst(sideOf('old')), proposed: sideOf('new') };
}

/** `count` Endpoints, each losing a field, beside a chain of `count` defs their Inputs do not reach. */
export function endpointsLosingFieldBesideUnreachedDefs(count: number): Shape {
  const sideOf = (fields: Readonly<Record<string, Field>>) =>
    aServiceOf(
      { ...endpointsOf(count, () => anObject(fields)), 'GET /chain': chainEndpointOf(count) },
      aChainOfObjects(count),
    );
  const baseline = sideOf({ k: required(aString), g: optional(aString) });
  return { baseline: publishedFirst(baseline), proposed: sideOf({ k: required(aString) }) };
}

/** A Baseline holding a Former Input for each of `count` Endpoints, beside a chain of `count` defs, and the Service as it stands. */
export function baselineHoldingFormerInputs(count: number): Shape {
  const kept = { k: required(aString) };
  const service = aServiceOf(
    { ...endpointsOf(count, () => anObject(kept)), 'GET /chain': chainEndpointOf(count) },
    aChainOfObjects(count),
  );
  const formerInputs = Array.from({ length: count }, (_, index): FormerInput => {
    const body = anObject({ ...kept, g: optional(aString) });
    const input = { query: emptyObject, body };
    return { endpoint: `PUT /e${index}`, removedIn: '1.1.0', input, defs: {} };
  });
  return publishedHolding(service, formerInputs);
}

/**
 * A Baseline holding a Former Input for each of `count` Endpoints whose body names, in a field,
 * the top of one chain of `count` alias defs: each Former Input holds the first def of the chain
 * as it was, named apart, with the field the chain's end has since lost.
 */
export function formerInputsNamingAnAliasChain(count: number): Shape {
  const chain = aChainOfAliases(count, 'kept');
  const body = anObject({ f: required(aRef(`a${count - 1}`)) });
  const service = aServiceOf(
    endpointsOf(count, () => body),
    chain,
  );
  const first = chain['a0'] as ObjectNode;
  const asItWas = { ...first, fields: { ...first.fields, q: optional(aString) } };
  const formerInputs = Array.from({ length: count }, (_, index): FormerInput => {
    const former = anObject({ f: required(aRef('a0~1')) });
    const input = { query: emptyObject, body: former };
    return { endpoint: `PUT /e${index}`, removedIn: '1.1.0', input, defs: { 'a0~1': asItWas } };
  });
  return publishedHolding(service, formerInputs);
}

/** One Endpoint whose body holds `count` fields, each naming its own def of two fields; the proposed Snapshot names one def of one field from all. */
export function defsNamedApartFromOne(count: number): Shape {
  const own = anObject({ p: required(aString), q: optional(aString) });
  const names = Array.from({ length: count }, (_, index) => `b${index}`);
  const bodyNaming = (name: (index: number) => string) =>
    anObject(
      Object.fromEntries(names.map((_, index) => [`f${index}`, required(aRef(name(index)))])),
    );
  const baseline = aServiceOf(
    { 'PUT /e': anEndpointOf(bodyNaming((index) => `b${index}`)) },
    Object.fromEntries(names.map((name) => [name, own])),
  );
  const proposed = aServiceOf(
    { 'PUT /e': anEndpointOf(bodyNaming(() => 'x')) },
    { x: anObject({ p: required(aString) }) },
  );
  return { baseline: publishedFirst(baseline), proposed };
}

/** `count` codes an Endpoint answers in the Baseline and no longer in the proposed Snapshot, beside a chain of `count` defs none of them reaches. */
export function codesNoEndpointAnswersBesideDefs(count: number): Shape {
  const names = Array.from({ length: count }, (_, index) => `LOCKED_${index}`);
  const locked = aCode({ status: 409, body: anObject({ at: required(aString) }) });
  const codes = Object.fromEntries(names.map((name) => [name, locked]));
  const sideOf = (rejections: readonly string[], declared: typeof codes) => {
    const answer = { ...chainEndpointOf(count), rejections };
    return aServiceOf({ 'GET /chain': answer }, aChainOfObjects(count), declared);
  };
  const baseline = sideOf(names, codes);
  return { baseline: publishedFirst(baseline), proposed: sideOf([], {}) };
}
