import type { EndpointSnapshot } from '../snapshot/index.ts';
import type { Field, ObjectNode } from '../walker/index.ts';
import { counterpartsOf } from './counterparts.ts';
import { unconstrainedTypeOf } from './enums.ts';
import type { BothDefs } from './findings.ts';
import type { Difference } from './report.ts';
import { type EndpointPlace, schemaDifferencesOf } from './schemas.ts';
import { fieldStep, partsOf, type Step } from './steps.ts';

/** A query or headers object of the Baseline and the proposed one, with no field where none is declared. */
export type TextParts = {
  readonly baseline: ObjectNode;
  readonly proposed: ObjectNode;
};

/**
 * Path params compared by position, as the URL matches them: a name changed is a rename, and each
 * schema is read as Input, found by its name in `params` since the object's keys are in code point
 * order, not in position.
 */
export function paramDifferencesOf(
  baseline: EndpointSnapshot,
  proposed: EndpointSnapshot,
  defs: BothDefs,
): readonly Difference[] {
  const differences: Difference[] = [];
  for (const [index, name] of proposed.params.entries()) {
    const was = baseline.params[index];
    if (was === undefined) {
      continue;
    }
    if (was !== name) {
      differences.push({ kind: 'param-renamed', from: was, to: name });
    }
    const params = { baseline: paramOf(baseline, was), proposed: paramOf(proposed, name) };
    differences.push(...paramSchemaDifferencesOf(params, defs, name));
  }
  return differences;
}

function paramOf(endpoint: EndpointSnapshot, name: string): Field | undefined {
  const fields = endpoint.input.params?.fields ?? {};
  return Object.hasOwn(fields, name) ? fields[name] : undefined;
}

/** A param either Snapshot holds no schema for cannot be proven compatible, so it is Breaking. */
function paramSchemaDifferencesOf(
  params: { readonly baseline: Field | undefined; readonly proposed: Field | undefined },
  defs: BothDefs,
  name: string,
): readonly Difference[] {
  const at = [...partsOf('input', 'params'), fieldStep(name)];
  if (params.baseline === undefined || params.proposed === undefined) {
    const shape = { kind: 'unproven', node: 'param' } as const;
    return [{ kind: 'schema', position: 'input', at, shape }];
  }
  const schemas = { baseline: params.baseline.schema, proposed: params.proposed.schema };
  return schemaDifferencesOf(schemas, defs, { position: 'input', at });
}

/** A query or headers compared as the open object it is. */
export function textPartDifferencesOf(
  parts: TextParts,
  defs: BothDefs,
  place: EndpointPlace,
): readonly Difference[] {
  return schemaDifferencesOf(parts, defs, place);
}

/**
 * Input headers as Input, then each optional one added whose schema refuses some text: a header
 * name is shared with proxies, gateways and browsers, which may already send it. Such a header is
 * left out of the proposed object, so it is `header-refuses-text` alone and no field added.
 */
export function inputHeaderDifferencesOf(
  parts: TextParts,
  defs: BothDefs,
  at: readonly Step[],
): readonly Difference[] {
  const { baseline, proposed } = parts;
  const refusing = counterpartsOf(baseline.fields, proposed.fields)
    .filter((header) => header.kind === 'added' && refusesSomeText(header.proposed))
    .map((header) => header.key);
  const accepted = { baseline, proposed: withoutFields(proposed, refusing) };
  const refusals = refusing.map((name) => refusalOf([...at, fieldStep(name)]));
  return [...textPartDifferencesOf(accepted, defs, { position: 'input', at }), ...refusals];
}

function refusalOf(at: readonly Step[]): Difference {
  return { kind: 'header-refuses-text', at };
}

function withoutFields(object: ObjectNode, names: readonly string[]): ObjectNode {
  const kept = Object.entries(object.fields).filter(([name]) => !names.includes(name));
  return { ...object, fields: Object.fromEntries(kept) };
}

/** Whether an optional header accepts less than every text, which a Caller may already send. */
function refusesSomeText(header: Field): boolean {
  return !header.required && unconstrainedTypeOf(header.schema) !== 'string';
}
