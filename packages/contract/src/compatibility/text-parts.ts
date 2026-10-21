import type { EndpointSnapshot } from '../snapshot/index.ts';
import type { Field, ObjectNode, Path } from '../walker/index.ts';
import { counterpartsOf } from './counterparts.ts';
import { unconstrainedTypeOf } from './enums.ts';
import type { BothDefs } from './findings.ts';
import type { Difference } from './report.ts';
import { type EndpointPlace, schemaDifferencesOf } from './schemas.ts';

/** A query or headers object of the Baseline and the proposed one, `null` where none is declared. */
export type TextParts = {
  readonly baseline: ObjectNode | null;
  readonly proposed: ObjectNode | null;
};

const noFields: ObjectNode = { type: 'object', mode: 'open', fields: {} };

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
  const at = ['input', 'params', 'fields', name];
  if (params.baseline === undefined || params.proposed === undefined) {
    const shape = { kind: 'unproven', node: 'param' } as const;
    return [{ kind: 'schema', position: 'input', at, shape }];
  }
  const schemas = { baseline: params.baseline.schema, proposed: params.proposed.schema };
  return schemaDifferencesOf(schemas, defs, { position: 'input', at });
}

/** The two objects of a part, one declared nowhere counting as an open object with no fields. */
function objectsOf(parts: TextParts): {
  readonly baseline: ObjectNode;
  readonly proposed: ObjectNode;
} {
  return { baseline: parts.baseline ?? noFields, proposed: parts.proposed ?? noFields };
}

/**
 * A query or headers compared as the open object it is: one declared nowhere has no fields, since
 * an undeclared part is never read.
 */
export function textPartDifferencesOf(
  parts: TextParts,
  defs: BothDefs,
  place: EndpointPlace,
): readonly Difference[] {
  return schemaDifferencesOf(objectsOf(parts), defs, place);
}

/**
 * Input headers as Input, then each optional one added whose schema refuses some text: a header
 * name is shared with proxies, gateways and browsers, which may already send it.
 */
export function inputHeaderDifferencesOf(
  parts: TextParts,
  defs: BothDefs,
  at: Path,
): readonly Difference[] {
  const { baseline, proposed } = objectsOf(parts);
  const refusing: Difference[] = [];
  for (const header of counterpartsOf(baseline.fields, proposed.fields)) {
    if (header.kind === 'added' && refusesSomeText(header.proposed)) {
      refusing.push({ kind: 'header-refuses-text', at: [...at, 'fields', header.key] });
    }
  }
  return [...textPartDifferencesOf(parts, defs, { position: 'input', at }), ...refusing];
}

/** Whether an optional header accepts less than every text, which a Caller may already send. */
function refusesSomeText(header: Field): boolean {
  return !header.required && unconstrainedTypeOf(header.schema) !== 'string';
}
