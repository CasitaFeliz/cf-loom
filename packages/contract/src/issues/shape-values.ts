import type * as core from 'zod/v4/core';
import { headerTextsOf } from '../wire/index.ts';
import {
  type Issue,
  type IssuePart,
  isPlainObject,
  type ReadShape,
  type ShapeFields,
  shapeSides,
} from '../written/index.ts';
import { type Checked, type GivenPart, parsedPartOf, writtenPartOf } from './checked-part.ts';

/** The sides a Read shape declares, with a value each; a side it declares none for has no key. */
export type ShapeValues = {
  readonly headers?: Readonly<Record<string, unknown>>;
  readonly body?: unknown;
};

type Side = (typeof shapeSides)[number];

type PartCheck = (part: IssuePart, schema: core.$ZodType | undefined, given: GivenPart) => Checked;

/** Each side of a shape checked: the values of those that passed, and the Issues of those that did not. */
type CheckedSides = {
  readonly values: Partial<Record<Side, unknown>>;
  readonly issues: readonly Issue[];
};

/**
 * What a Handler gave, parsed with the schema of each side its shape declares, unknown keys
 * stripped, and its headers checked to travel as text once both sides parse; a value for a side it
 * declares none for is an Issue.
 */
export function parsedShapeOf(shape: ReadShape, fields: ShapeFields): Checked<ShapeValues> {
  const { values, issues } = checkedSidesOf(shape, fields, parsedPartOf);
  return resultOf(shape, values, issues.length > 0 ? issues : unsendableIssuesOf(shape, values));
}

/**
 * What a test scripted, written back through the Reader of each side its shape declares, as it
 * travels, and the headers written checked to travel as text, whatever the body's Issues; a value
 * for a side it declares none for is an Issue.
 */
export function writtenShapeOf(shape: ReadShape, fields: ShapeFields): Checked<ShapeValues> {
  const { values, issues } = checkedSidesOf(shape, fields, writtenPartOf);
  return resultOf(shape, values, [...issues, ...unsendableIssuesOf(shape, values)]);
}

/** What a party received, read with the Reader of each side its shape declares; a side it declares none for is ignored. */
export function readShapeOf(shape: ReadShape, fields: ShapeFields): Checked<ShapeValues> {
  const { values, issues } = checkedSidesOf(shape, fields, readPartOf);
  return resultOf(shape, values, issues);
}

function readPartOf(part: IssuePart, schema: core.$ZodType | undefined, given: GivenPart): Checked {
  return schema === undefined
    ? { kind: 'value', value: undefined }
    : parsedPartOf(part, schema, given);
}

function checkedSidesOf(shape: ReadShape, fields: ShapeFields, check: PartCheck): CheckedSides {
  const values: Partial<Record<Side, unknown>> = {};
  const issues: Issue[] = [];
  for (const side of shapeSides) {
    const { part, schema } = shape[side];
    const checked = check(part, schema, { value: fields[side] });
    if (checked.kind === 'issues') {
      issues.push(...checked.issues);
    } else if (schema !== undefined) {
      values[side] = checked.value;
    }
  }
  return { values, issues };
}

/** The Issues of the headers written that cannot travel as field text. */
function unsendableIssuesOf(shape: ReadShape, values: Partial<Record<Side, unknown>>) {
  const headers = isPlainObject(values.headers) ? values.headers : undefined;
  const texts = headerTextsOf(shape.headers.part, headers);
  return texts.kind === 'issues' ? texts.issues : [];
}

function resultOf(
  shape: ReadShape,
  values: Partial<Record<Side, unknown>>,
  issues: readonly Issue[],
): Checked<ShapeValues> {
  if (issues.length > 0) {
    return { kind: 'issues', issues };
  }
  const headers = isPlainObject(values.headers) ? values.headers : {};
  return {
    kind: 'value',
    value: {
      ...(shape.headers.schema === undefined ? {} : { headers }),
      ...(shape.body.schema === undefined ? {} : { body: values.body }),
    },
  };
}
