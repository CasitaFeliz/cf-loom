import type * as core from 'zod/v4/core';
import {
  type Endpoint,
  isRejection,
  isStandardRejection,
  type ProvidedStandardRejections,
  type Rejection,
  type StandardRejection,
} from '../declarations/index.ts';
import { type Part, schemaOf } from './parts.ts';

/** One side of a Read shape: the Part it sits in and the schema that reads it, none when the declaration gives it none. */
export type ShapeSide<Named extends Part> = {
  readonly part: Named;
  readonly schema: core.$ZodType | undefined;
};

/**
 * The headers and body of a Success or a Rejection, each with its Part and its schema: the one
 * description that what is given, parsed, written back and read of them all follow.
 */
export type ReadShape = {
  readonly headers: ShapeSide<'success.headers' | 'headers'>;
  readonly body: ShapeSide<'success.body' | 'body'>;
};

/** The two sides of a Read shape, headers first. */
export const shapeSides = ['headers', 'body'] as const satisfies readonly (keyof ReadShape)[];

/** What a Read shape holds, side by side, before anything judges it. */
export type ShapeFields = { readonly headers: unknown; readonly body: unknown };

/** The shape of an Endpoint's Success. */
export function successShapeOf(endpoint: Endpoint): ReadShape {
  return {
    headers: { part: 'success.headers', schema: schemaOf(endpoint, 'success.headers') },
    body: { part: 'success.body', schema: schemaOf(endpoint, 'success.body') },
  };
}

/**
 * The shape of a Rejection; a Standard Rejection declares neither side, but invalid input's body
 * is the Reader of the Provider's `standards`, none where they are not given.
 */
export function rejectionShapeOf(
  rejection: Rejection | StandardRejection,
  standards?: ProvidedStandardRejections,
): ReadShape {
  return {
    headers: {
      part: 'headers',
      schema: isRejection(rejection) ? schemaOf(rejection, 'headers') : undefined,
    },
    body: { part: 'body', schema: rejectionBodySchemaOf(rejection, standards) },
  };
}

function rejectionBodySchemaOf(
  rejection: Rejection | StandardRejection,
  standards: ProvidedStandardRejections | undefined,
): core.$ZodType | undefined {
  if (!isStandardRejection(rejection)) {
    return schemaOf(rejection, 'body');
  }
  return rejection.name === 'invalidInput' ? standards?.invalidInput.body : undefined;
}

/**
 * What `success()` and `reject()` are given after their declaration, and their scripted twins, by
 * side: the body alone where the shape declares no headers, else `{ headers, body }`; the one place
 * that reads it.
 */
export function shapeFieldsOf(shape: ReadShape, given: unknown): ShapeFields {
  if (shape.headers.schema === undefined) {
    return { headers: undefined, body: given };
  }
  if (typeof given !== 'object' || given === null) {
    return { headers: undefined, body: undefined };
  }
  const fields: Readonly<Record<string, unknown>> = { ...given };
  return { headers: fields['headers'], body: fields['body'] };
}
