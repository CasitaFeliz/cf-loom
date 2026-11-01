import { basename } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { forgetChain, groupedByDeclaredSnapshot, inputOf } from './chain-fixtures.ts';
import { holdingText, holdingTextsOf } from './chain-holding-types.ts';
import type { ChainReader } from './chain-readers.ts';
import { checkStages } from './check-stages.ts';
import { generateStages, generateWritesText } from './generate-stages.ts';
import { orderOf, orders } from './growth.ts';
import { idChains, type TableChain } from './id-chains.ts';
import { packageStages } from './package-stages.ts';
import { publishStages, publishWritesText } from './publish-stages.ts';
import type { ChainStage, NoStage } from './stage-type.ts';

/**
 * Every export of `./internal` that reads or makes a chain, each with the calls a command makes of
 * it, or why none is timed here; a reader added to `./internal` fails to compile until it has one
 * or the other.
 */
export const chainStages = {
  ...generateStages,
  ...publishStages,
  ...checkStages,
  ...packageStages,
  canonicalTextOf: [generateWritesText, publishWritesText],
  walkSchemas: { reason: 'run inside validateRoot, which is timed' },
  snapshotOf: { reason: 'reads what validateRoot built, and is timed in it: constant beside it' },
  firstPublishChangesOf: { reason: 'reads the Elements of a first version, never a def' },
  defScopesOf: { reason: 'run inside nestingFailureOf and decodeSnapshot, which are timed' },
  ownRejectionsOf: { reason: 'reads the codes an Endpoint lists, never a def: a count' },
  brokerPlanOf: { reason: 'reads Messages and Subscriptions, never a def: a count' },
  isRemoved: { reason: 'reads one code’s mark' },
  isEmptyTextPart: { reason: 'reads one node’s fields: a width' },
  textPartNodesOf: { reason: 'reads one Endpoint’s text parts, never a def: a width' },
  textPartsOf: { reason: 'reads one Request’s text parts, never a def: a width' },
  headerValuesOf: { reason: 'reads one Response’s headers, never a def: a width' },
  exportedEntryOf: { reason: 'one lookup by identity' },
  exportedCodeOf: { reason: 'one lookup by code' },
} as const satisfies Record<ChainReader, readonly [ChainStage, ...ChainStage[]] | NoStage>;

const sizes = { small: 2_000, large: 16_000 };

/** How many links a chain's node type is read from. */
const linksWalked = 3;

const { validateRoot: generate, ...afterGenerate } = chainStages;

/** The chain whose stem a growth file carries in its name. */
function chainOfFile(file: string): TableChain {
  const stem = basename(file, '.growth.test.ts');
  const chain = idChains.find((candidate) => candidate.stem === stem);
  if (chain === undefined) {
    throw new Error(`No chain has the stem ${stem}: ${file} names none.`);
  }
  return chain;
}

/** Whether no chain before this one in the table declares the Snapshot it declares. */
function isFirstToDeclare(chain: TableChain): boolean {
  return groupedByDeclaredSnapshot(idChains).some(([first]) => first === chain);
}

/** The stages timed on a chain: `generate` always, the rest once for each Snapshot declared. */
function stagesOf(chain: TableChain): ChainStage[] {
  const stages: ChainStage[] = [...generate];
  if (!isFirstToDeclare(chain)) {
    return stages;
  }
  for (const stagesOrReason of Object.values(afterGenerate)) {
    for (const stage of 'reason' in stagesOrReason ? [] : stagesOrReason) {
      stages.push(stage);
    }
  }
  return stages;
}

/**
 * Declares the family of the chain a growth file is named for, from the file's own path: the
 * node-type test, then every stage's order of growth at 2,000 and 16,000 links under
 * `orders.linear`; past `generate`, only for the first chain of the table that declares its
 * Snapshot. A stem no chain has throws, so a file names its chain once, in its name.
 */
export function describeChainFamily(file: string): void {
  const chain = chainOfFile(file);
  describe(`./internal, a chain of ids, each link holding the one before as ${chain.holdings.map(holdingText).join(' and ')}`, () => {
    afterAll(() => forgetChain(chain));

    test(`walks each link to a node of type \`${chain.type}\``, () => {
      const declared = inputOf(chain, linksWalked, 'declared');
      const stated = chain.holdings.map(holdingText).sort();

      for (let link = 1; link < linksWalked; link++) {
        expect(holdingTextsOf(declared, link).sort()).toEqual(stated);
      }
    });

    test.each(stagesOf(chain))(
      "$name takes time of linear order in the chain's length",
      (stage) => {
        stage.checkOf(stage.callOf(chain, sizes.large)(), sizes.large);

        const order = orderOf((count) => stage.callOf(chain, count), sizes, orders.linear);

        expect(order).toBeLessThan(orders.linear);
      },
    );
  });
}
