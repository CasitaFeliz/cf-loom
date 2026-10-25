import type * as core from 'zod/v4/core';
import { type Guard, isGuard, isRejection, type Rejection } from '../declarations/index.ts';
import { isSchema } from './parts.ts';

/** A Definitions Package's members, by kind, each with every name it is exported under. */
export type Members = {
  readonly guards: readonly Guard[];
  readonly rejections: readonly Rejection[];
  readonly schemas: readonly (readonly [name: string, schema: core.$ZodType])[];
};

/**
 * What a Definitions Package holds: each export that is a Guard, a Rejection or a zod schema, by
 * export name; the Definitions object and anything else are left out.
 */
export function membersOf(exports: Readonly<Record<string, unknown>>): Members {
  const names = Object.keys(exports);
  const values = Object.values(exports);
  const schemas: (readonly [string, core.$ZodType])[] = [];
  for (const name of names) {
    const value = exports[name];
    if (isSchema(value)) {
      schemas.push([name, value]);
    }
  }
  return {
    guards: [...new Set(values.filter(isGuard))],
    rejections: [...new Set(values.filter(isRejection))],
    schemas,
  };
}
