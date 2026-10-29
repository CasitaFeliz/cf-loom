import { openEnumReader, type StandardRejections } from '@cf-loom/contract';
import { z } from 'zod';

/** The invalid-input body's Reader as `cf-loom package` writes it. */
export const invalidInputBody = z.object({
  issues: z.array(
    z.object({
      code: openEnumReader([
        'invalid_format',
        'invalid_type',
        'invalid_value',
        'malformed',
        'not_multiple',
        'required',
        'too_big',
        'too_small',
        'unrecognized_key',
      ]),
      in: openEnumReader(['body', 'headers', 'params', 'query']),
      message: z.string(),
      path: z.array(z.union([z.string(), z.number()])),
    }),
  ),
  omittedIssues: z.int().min(0),
});

const defaults = {
  invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
  notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
  notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
} as const;

type Declared = Partial<StandardRejections>;

type Resolved<Overrides extends Declared> = {
  readonly invalidInput: (Overrides extends { readonly invalidInput: infer Declaration }
    ? Declaration
    : typeof defaults.invalidInput) & { readonly body: typeof invalidInputBody };
  readonly notFound: Overrides extends { readonly notFound: infer Declaration }
    ? Declaration
    : typeof defaults.notFound;
  readonly notImplemented: Overrides extends { readonly notImplemented: infer Declaration }
    ? Declaration
    : typeof defaults.notImplemented;
};

/**
 * A Provider's Standard Rejections as its Contract Package carries them: cf-loom's defaults, the
 * ones given instead, and the invalid-input Reader, typed by the literals given.
 */
export function providedStandardRejections<const Overrides extends Declared = Record<never, never>>(
  overrides: Overrides = {} as Overrides,
): Resolved<Overrides> {
  const resolved = {
    invalidInput: { ...defaults.invalidInput, ...overrides.invalidInput, body: invalidInputBody },
    notFound: { ...defaults.notFound, ...overrides.notFound },
    notImplemented: { ...defaults.notImplemented, ...overrides.notImplemented },
  };
  return resolved as unknown as Resolved<Overrides>;
}
