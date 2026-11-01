import { expect } from 'vitest';
import { z } from 'zod';
import { providedEndpoint } from '../src/index.ts';
import {
  canonicalTextOf,
  exportedCutOf,
  exportedSnapshotOf,
  hashedTextOf,
  providedSnapshotOf,
  reachedDefsOf,
} from '../src/internal/index.ts';
import { anEchoTaking, identity, inputOf } from './chain-fixtures.ts';
import { defsOfText, type StagesOf, stage } from './chain-stage.ts';
import { aProvider } from './providers.ts';

/** What `package` and an Application read a chain with: the cut, its text, its hash, the defs it reaches and the cut a Provided Endpoint carries. */
export const packageStages = {
  exportedSnapshotOf: [
    stage(
      "package cuts and writes the Snapshot, as package's sequence does",
      (chain, count) => {
        const grafted = inputOf(chain, count, 'grafted');
        return () => [exportedSnapshotOf(grafted), canonicalTextOf(grafted)] as const;
      },
      ([cut], count) => expect(Object.keys(cut.defs).length).toBe(count),
    ),
  ],
  exportedCutOf: [
    stage(
      'package cuts an Endpoint',
      (chain, count) => {
        const grafted = inputOf(chain, count, 'grafted');
        return () => exportedCutOf(grafted, identity);
      },
      (given, count) => expect(Object.keys(given.defs).length).toBe(count),
    ),
  ],
  hashedTextOf: [
    stage(
      'package hashes the Snapshot',
      (chain, count) => {
        const grafted = inputOf(chain, count, 'grafted');
        return () => hashedTextOf(grafted);
      },
      (given, count) => expect(defsOfText(given)).toBe(count),
    ),
  ],
  reachedDefsOf: [
    stage(
      'package reaches the defs',
      (chain, count) => {
        const { defs } = inputOf(chain, count, 'grafted');
        const top = defs[`link${count - 1}`] ?? { type: 'string' };
        return () => reachedDefsOf([top], defs);
      },
      (given, count) => expect(given).toHaveLength(count),
    ),
  ],
  providedSnapshotOf: [
    stage(
      "an Application reads a Provided Endpoint's cut",
      (chain, count) => {
        const cut = exportedCutOf(inputOf(chain, count, 'grafted'), identity);
        const echo = anEchoTaking(z.object({}));
        const provided = providedEndpoint(aProvider('shapes-service'), echo, cut);
        return () => providedSnapshotOf(provided);
      },
      (given, count) => expect(Object.keys(given.defs).length).toBe(count),
    ),
  ],
} as const satisfies StagesOf<
  'exportedSnapshotOf' | 'exportedCutOf' | 'hashedTextOf' | 'reachedDefsOf' | 'providedSnapshotOf'
>;
