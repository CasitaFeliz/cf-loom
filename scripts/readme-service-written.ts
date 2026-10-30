import { inject } from 'vitest';
import { readmeServiceRefusals } from './readme-snippets.ts';

const refusals = readmeServiceRefusals(inject('readmeService'));

if (refusals.length > 0) {
  throw new Error(
    `The README Service was not written whole, so its tests cannot run:\n${refusals.join('\n')}`,
  );
}
