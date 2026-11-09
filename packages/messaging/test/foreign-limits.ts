import {
  type Foreign,
  type ForeignLabel,
  foreignValues,
} from '../../contract/test/foreign-values.ts';

/** Limits as an organization writes them: groups of settings, each setting a value. */
type Limits = object;

/** What a refusal shows of a value of the pool, and whether reading a setting as one value or a list of them touches it. */
type ShownAs = {
  /** A string, number, boolean, `null` or `undefined` as `util.inspect` prints it, a list held as data with its entries, anything else the words of its kind. */
  readonly shown: string;
  /** What it shows of it past the nesting a refusal shows: a list is `[Array]`, anything else the same. */
  readonly past: string;
  /** Whether that reading runs its code or throws, before any refusal: the reader's, not the refusal's. */
  readonly touchedByListRead: boolean;
};

function shownAs(shown: string, others: Partial<ShownAs> = {}): ShownAs {
  return { shown, past: shown, touchedByListRead: false, ...others };
}

const listPast = { past: '[Array]' };

const shownOf: Readonly<Record<ForeignLabel, ShownAs>> = {
  'a custom inspect': shownAs('an object'),
  'a custom inspect in a list': shownAs('[ an object ]', listPast),
  'a custom inspect as a Map key': shownAs('an object'),
  'an Error whose cause has a custom inspect': shownAs('an object'),
  'a function that converts itself to text': shownAs('a function'),
  'a multi-line function': shownAs('a function'),
  'an object whose prototype is a Proxy': shownAs('an object'),
  'a RegExp with a source getter': shownAs('an object'),
  'a Proxy object': shownAs('an object'),
  'a Proxy function': shownAs('a function'),
  'a Proxy list': shownAs('a list', { touchedByListRead: true }),
  'a list with an index getter': shownAs('a list', { ...listPast, touchedByListRead: true }),
  'an object with an enumerable getter': shownAs('an object'),
  'an Array subclass with a species getter': shownAs("[ '1s' ]", {
    ...listPast,
    touchedByListRead: true,
  }),
  'an Error with a name getter': shownAs('an object'),
  'a list with a Proxy prototype': shownAs("[ '30s' ]", { ...listPast, touchedByListRead: true }),
  'a list with its own custom inspect': shownAs("[ '30s', '0s' ]", listPast),
  'a sparse list': shownAs('a list', listPast),
  'an object with no prototype': shownAs('an object'),
  'an object of seconds': shownAs('an object'),
  'a list with an extra key': shownAs("[ '30s', '0s' ]", listPast),
  'a revoked Proxy': shownAs('an object', { touchedByListRead: true }),
  'a Symbol with a line break': shownAs('a symbol'),
  'a bigint': shownAs('a bigint'),
};

/** A value of the pool with what a refusal shows of it. */
export type ShownForeign = Foreign & ShownAs;

/** Every value of the pool, each with what a refusal shows of it. */
export function shownForeignValues(hooked: () => unknown): readonly ShownForeign[] {
  return foreignValues(hooked).map((foreign) => ({ ...foreign, ...shownOf[foreign.label] }));
}

/** The settings of one group of limits, none when it is left out. */
function groupOf(limits: Limits, group: string): object {
  return Reflect.get(limits, group) ?? {};
}

/** A value the setting types do not allow, given at one setting of valid limits, and what its refusal shows of it. */
export type LimitsPlace = {
  readonly name: string;
  readonly path: string;
  readonly limits: Limits;
  readonly shown: string;
};

/** A setting of the limits: its group and its name. */
type Site = { readonly group: string; readonly setting: string };

function limitsWith(valid: Limits, { group, setting }: Site, value: unknown): Limits {
  return { ...valid, [group]: { ...groupOf(valid, group), [setting]: value } };
}

/** Every setting of the limits. */
function sitesOf(valid: Limits): readonly Site[] {
  return Object.keys(valid).flatMap((group) =>
    Object.keys(groupOf(valid, group)).map((setting) => ({ group, setting })),
  );
}

/** Where a setting sits in the limits, as a refusal names it: `limits.streamDefaults.maxAge`. */
function pathOf({ group, setting }: Site): string {
  return `limits.${group}.${setting}`;
}

/** A value at the depth past which a refusal shows no more of a list: three lists in, where `util.inspect` shows a list as `[Array]`. */
function nestedShown(past: string): string {
  return `[ [ [ ${past} ] ] ]`;
}

/**
 * Each value of the pool at each setting of valid limits, alone, as an entry of an ack wait list and
 * three lists deep; alone at ackWait only a value that reading the setting as one value or a list of
 * them leaves untouched, which the reader cannot know before it reads it.
 */
export function limitsPlacesOf(valid: Limits, hooked: () => unknown): readonly LimitsPlace[] {
  const places: LimitsPlace[] = [];
  for (const site of sitesOf(valid)) {
    const path = pathOf(site);
    for (const { label, value, shown, past, touchedByListRead } of shownForeignValues(hooked)) {
      if (!(site.setting === 'ackWait' && touchedByListRead)) {
        places.push({
          name: `${path}, ${label}`,
          path,
          limits: limitsWith(valid, site, value),
          shown,
        });
      }
      if (site.setting === 'ackWait') {
        const limits = limitsWith(valid, site, ['30s', value]);
        places.push({ name: `${path} list, ${label}`, path, limits, shown: `[ '30s', ${shown} ]` });
      }
      const nested = limitsWith(valid, site, [[[value]]]);
      places.push({
        name: `${path} nested, ${label}`,
        path,
        limits: nested,
        shown: nestedShown(past),
      });
    }
  }
  return places;
}

/** The valid limits with `-1.5` at each setting, which no setting's type allows, and the place it sits at. */
export function referencesOf(valid: Limits): readonly Pick<LimitsPlace, 'path' | 'limits'>[] {
  return sitesOf(valid).map((site) => ({
    path: pathOf(site),
    limits: limitsWith(valid, site, -1.5),
  }));
}

/** What a setting's type is, as the refusal of `-1.5` at it says: the words after `<place> -1.5 is not `. */
export function expectedSentenceOf(message: string, path: string): string {
  const start = `${path} -1.5 is not `;
  if (!message.startsWith(start)) {
    throw new Error(`the refusal of -1.5 at ${path} reads ${message}`);
  }
  return message.slice(start.length);
}

/** Each value of the pool as an AWS account, alone, as the only entry of a list and three lists deep, and what a refusal shows of it. */
export function accountPlacesOf(
  hooked: () => unknown,
): readonly { readonly name: string; readonly account: unknown; readonly shown: string }[] {
  return shownForeignValues(hooked).flatMap(({ label, value, shown, past }) => [
    { name: label, account: value, shown },
    { name: `${label} in a list`, account: [value], shown: `[ ${shown} ]` },
    { name: `${label} nested`, account: [[[value]]], shown: nestedShown(past) },
  ]);
}
