import { expect } from 'vitest';
import {
  canonicalSnapshotOf,
  canonicalTextOf,
  nestingFailureOf,
  snapshotOf,
  validateRoot,
} from '../src/internal/index.ts';
import { aRootHolding, inputOf } from './chain-fixtures.ts';
import { aRootPackage } from './root-package.ts';
import type { StagesOf } from './stage-type.ts';
import { defsOfText, stage } from './stage-type.ts';

/** What `generate` runs on a chain: it validates the Root, declares the Snapshot and writes it. */
export const generateStages = {
  validateRoot: [
    stage(
      "generate declares the Snapshot, as declaredOf's sequence does",
      (chain, count) => {
        const root = aRootHolding(chain, count, 'top');
        const rootPackage = aRootPackage(root);
        return () => {
          const validated = validateRoot(root, rootPackage);
          if (validated.kind !== 'valid') {
            return validated;
          }
          const declared = snapshotOf(validated);
          return nestingFailureOf(declared) ?? canonicalTextOf(canonicalSnapshotOf(declared));
        };
      },
      (given, count) => {
        expect(typeof given).toBe('string');
        expect(defsOfText(given as string)).toBe(count);
      },
    ),
  ],
  nestingFailureOf: [
    stage(
      'generate judges the nesting',
      (chain, count) => {
        const declared = inputOf(chain, count, 'declared');
        return () => nestingFailureOf(declared);
      },
      (given) => expect(given).toBeUndefined(),
    ),
  ],
  canonicalSnapshotOf: [
    stage(
      'generate orders the Snapshot',
      (chain, count) => {
        const declared = inputOf(chain, count, 'declared');
        return () => canonicalSnapshotOf(declared);
      },
      (given, count) => expect(Object.keys(given.defs).length).toBe(count),
    ),
  ],
} as const satisfies StagesOf<'validateRoot' | 'nestingFailureOf' | 'canonicalSnapshotOf'>;

/** The call `generate` writes the Snapshot's text with. */
export const generateWritesText = stage(
  'generate writes the text',
  (chain, count) => {
    const ordered = canonicalSnapshotOf(inputOf(chain, count, 'declared'));
    return () => canonicalTextOf(ordered);
  },
  (given, count) => expect(defsOfText(given)).toBe(count),
);
