import { z } from 'zod';

/** cf-loom's default Standard Rejections as a Contract Package carries them, with an invalid-input Reader. */
const standardRejections = {
  invalidInput: {
    code: 'INVALID_INPUT',
    status: 400,
    message: 'Invalid input',
    body: z.object({ issues: z.array(z.unknown()) }),
  },
  notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
  notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
} as const;

/** A Provider as its Contract Package's Endpoints carry it: its name and cf-loom's default Standard Rejections. */
export function aProvider<const Name extends string>(
  name: Name,
): { readonly name: Name; readonly standardRejections: typeof standardRejections } {
  return { name, standardRejections };
}
