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
 * Path params compared as the text part they are, read as Input, with a name matched by its
 * position, as the URL matches it: each position whose name moved is a rename, and the Baseline's
 * fields are read under the proposed names, so the two objects compare field by field.
 */
export function paramDifferencesOf(
  baseline: EndpointSnapshot,
  proposed: EndpointSnapshot,
  defs: BothDefs,
): readonly Difference[] {
  const renames = proposed.params.flatMap((name, index): Difference[] => {
    const was = baseline.params[index];
    return was === undefined || was === name
      ? []
      : [{ kind: 'param-renamed', from: was, to: name }];
  });
  if (baseline.input.params === null || proposed.input.params === null) {
    return renames;
  }
  const parts = {
    baseline: underProposedNames(baseline.input.params, baseline.params, proposed.params),
    proposed: proposed.input.params,
  };
  const place = { position: 'input', at: partsOf('input', 'params') } as const;
  return [...renames, ...textPartDifferencesOf(parts, defs, place)];
}

/** The Baseline's params object with each field under the name the proposed Snapshot gives its position. */
function underProposedNames(
  object: ObjectNode,
  baselineNames: readonly string[],
  proposedNames: readonly string[],
): ObjectNode {
  const renamed = Object.entries(object.fields).map(([name, field]) => {
    const position = baselineNames.indexOf(name);
    return [proposedNames[position] ?? name, field] as const;
  });
  return { ...object, fields: Object.fromEntries(renamed) };
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
