import { join } from 'node:path';
import { readmeServiceRefusals } from './readme-snippets.ts';

const refusals = readmeServiceRefusals(join(import.meta.dirname, '..', '.readme-service'));

if (refusals.length > 0) {
  throw new Error(
    `The README Service was not written whole, so its tests cannot run:\n${refusals.join('\n')}`,
  );
}
