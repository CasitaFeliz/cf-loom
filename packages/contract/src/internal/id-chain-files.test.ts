import { readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { groupedByDeclaredSnapshot } from '../../test/chain-fixtures.ts';
import { idChains } from '../../test/id-chains.ts';

/** The stems of the growth files that sit beside `./internal`'s entry, as their names carry them. */
function stemsOfGrowthFiles(): string[] {
  const suffix = '.growth.test.ts';
  return readdirSync(import.meta.dirname)
    .filter((name) => name.startsWith('id-chains.') && name.endsWith(suffix))
    .map((name) => name.slice(0, -suffix.length))
    .sort();
}

describe('./internal, the chains of ids and the files that time them', () => {
  test("the family's growth files are the chains of the table, one each", () => {
    const stems = idChains.map(({ stem }) => stem).sort();

    expect(stemsOfGrowthFiles()).toEqual(stems);
  });

  test("every chain's name is lower-case words joined by hyphens", () => {
    const names = idChains.map(({ name }) => name);

    expect(names.filter((name) => !/^[a-z]+(-[a-z]+)*$/.test(name))).toEqual([]);
  });

  test('chains that declare one Snapshot are timed once after generate, and every other chain declares its own', () => {
    const groups = groupedByDeclaredSnapshot(idChains).map((group) =>
      group.map(({ stem }) => stem),
    );

    expect(groups.filter((group) => group.length > 1)).toEqual([
      ['id-chains.object.field', 'id-chains.object.inline-lazy'],
    ]);
  });

  test('every chain states that its links hold the link before through the node type its file is named for', () => {
    const typesOf = (holdings: readonly (readonly (string | { readonly type: string })[])[]) =>
      holdings.flat().map((step) => (typeof step === 'string' ? step : step.type));

    const unrelated = idChains.filter(({ type, holdings }) => !typesOf(holdings).includes(type));

    expect(unrelated.map(({ stem }) => stem)).toEqual([]);
  });
});
