import { foreignValues } from '../../contract/test/foreign-values.ts';

/** Limits as an organization writes them: groups of settings, each setting a value. */
type Limits = object;

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

/**
 * Each value of the pool at each setting of valid limits, alone and as an entry of an ack wait list;
 * alone at ackWait only a value whose reading runs none of its code, which the reader of a setting
 * that is one or a list of them cannot know before it reads it.
 */
export function limitsPlacesOf(valid: Limits, hooked: () => unknown): readonly LimitsPlace[] {
  const places: LimitsPlace[] = [];
  for (const site of sitesOf(valid)) {
    const { setting } = site;
    const path = pathOf(site);
    for (const { label, value, shown, readRunsCode } of foreignValues(hooked)) {
      if (!(setting === 'ackWait' && readRunsCode)) {
        const limits = limitsWith(valid, site, value);
        places.push({ name: `${path}, ${label}`, path, limits, shown });
      }
      if (setting === 'ackWait') {
        const limits = limitsWith(valid, site, ['30s', value]);
        places.push({ name: `${path} list, ${label}`, path, limits, shown: `[ '30s', ${shown} ]` });
      }
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

/** Each value of the pool as an AWS account, alone and as the only entry of a list, and what a refusal shows of it. */
export function accountPlacesOf(
  hooked: () => unknown,
): readonly { readonly name: string; readonly account: unknown; readonly shown: string }[] {
  return foreignValues(hooked).flatMap(({ label, value, shown }) => [
    { name: label, account: value, shown },
    { name: `${label} in a list`, account: [value], shown: `[ ${shown} ]` },
  ]);
}
