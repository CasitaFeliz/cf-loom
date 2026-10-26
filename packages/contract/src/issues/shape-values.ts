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

type PartCheck = (part: IssuePart, schema: core.$ZodType | undefined, given: GivenPart) => Checked;

/**
 * What a Handler gave, parsed with the schema of each side its shape declares, unknown keys
 * stripped, and its headers checked to travel as text; a value for a side it declares none for is an Issue.
 */
export function parsedShapeOf(shape: ReadShape, fields: ShapeFields): Checked<ShapeValues> {
  return travellingHeadersOf(shape, checkedSidesOf(shape, fields, parsedPartOf));
}

/**
 * What a test scripted, written back through the Reader of each side its shape declares, as it
 * travels, and its headers checked to travel as text; a value for a side it declares none for is an Issue.
 */
export function writtenShapeOf(shape: ReadShape, fields: ShapeFields): Checked<ShapeValues> {
  return travellingHeadersOf(shape, checkedSidesOf(shape, fields, writtenPartOf));
}

/** What a party received, read with the Reader of each side its shape declares; a side it declares none for is ignored. */
export function readShapeOf(shape: ReadShape, fields: ShapeFields): Checked<ShapeValues> {
  return checkedSidesOf(shape, fields, readPartOf);
}

function readPartOf(part: IssuePart, schema: core.$ZodType | undefined, given: GivenPart): Checked {
  return schema === undefined
    ? { kind: 'value', value: undefined }
    : parsedPartOf(part, schema, given);
}

function checkedSidesOf(
  shape: ReadShape,
  fields: ShapeFields,
  check: PartCheck,
): Checked<ShapeValues> {
  const values: Partial<Record<(typeof shapeSides)[number], unknown>> = {};
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
  if (issues.length > 0) {
    return { kind: 'issues', issues };
  }
  return { kind: 'value', value: declaredValuesOf(shape, values) };
}

function declaredValuesOf(
  shape: ReadShape,
  values: Partial<Record<(typeof shapeSides)[number], unknown>>,
): ShapeValues {
  const headers = isPlainObject(values.headers) ? values.headers : {};
  return {
    ...(shape.headers.schema === undefined ? {} : { headers }),
    ...(shape.body.schema === undefined ? {} : { body: values.body }),
  };
}

function travellingHeadersOf(
  shape: ReadShape,
  checked: Checked<ShapeValues>,
): Checked<ShapeValues> {
  if (checked.kind === 'issues') {
    return checked;
  }
  const texts = headerTextsOf(shape.headers.part, checked.value.headers);
  return texts.kind === 'issues' ? texts : checked;
}
