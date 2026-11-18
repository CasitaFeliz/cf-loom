import { dottedPathOf } from '../src/internal/index.ts';
import { lineBreaks } from './line-breaks.ts';
import { drawnName, drawnVersion } from './random-broker-plans.ts';

type Next = () => number;

/** Where a text sits in a plan: the keys and indexes from its root. */
export type Path = readonly (string | number)[];

/** A text of a plan: where it sits, whether it is the key of a map, and the text. */
export type TextSite = {
  readonly path: Path;
  readonly isKey: boolean;
  readonly text: string;
};

function collectTexts(node: unknown, path: Path, sites: TextSite[]): void {
  if (typeof node === 'string') {
    sites.push({ path, isKey: false, text: node });
  } else if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) {
      collectTexts(item, [...path, index], sites);
    }
  } else if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      collectTexts(value, [...path, key], sites);
    }
  }
}

/**
 * Every text of a plan the Broker receives, found by walking it: the key of each entry of an object
 * the plan holds, and every text inside it. A field the plan gains is a site too.
 */
export function textSitesOf(plan: unknown): readonly TextSite[] {
  const sites: TextSite[] = [];
  for (const [field, listing] of Object.entries(Object(plan))) {
    if (typeof listing !== 'object' || listing === null) {
      continue;
    }
    for (const [key, entry] of Object.entries(listing)) {
      sites.push({ path: [field, key], isKey: true, text: key });
      collectTexts(entry, [field, key], sites);
    }
  }
  return sites;
}

function valueAt(root: unknown, path: Path): unknown {
  let node = root;
  for (const step of path) {
    node = Reflect.get(Object(node), step);
  }
  return node;
}

/** A copy of the plan with the text at a site replaced; a key keeps its place among its map's keys. */
export function withText(plan: unknown, site: TextSite, text: string): unknown {
  const edited = structuredClone(plan);
  const last = site.path.at(-1) ?? '';
  const parentPath = site.path.slice(0, -1);
  const parent = valueAt(edited, parentPath);
  if (site.isKey) {
    const renamed = Object.entries(Object(parent)).map(([key, entry]) => [
      key === last ? text : key,
      entry,
    ]);
    Reflect.set(
      Object(valueAt(edited, parentPath.slice(0, -1))),
      parentPath.at(-1) ?? '',
      Object.fromEntries(renamed),
    );
  } else {
    Reflect.set(Object(parent), last, text);
  }
  return edited;
}

/** A copy of the plan without the entry of a map at a path. */
export function withoutEntry(plan: unknown, path: Path): unknown {
  const edited = structuredClone(plan);
  Reflect.deleteProperty(Object(valueAt(edited, path.slice(0, -1))), path.at(-1) ?? '');
  return edited;
}

/** The place a site has once a mutation wrote its text, the key a text renames included. */
export function placeOf(site: TextSite, text: string): Path {
  return site.isKey ? [...site.path.slice(0, -1), text] : site.path;
}

/** A path as a plan's refusal writes it: its keys joined by dots, each as one key. */
export function dottedOf(path: Path): string {
  return dottedPathOf(path);
}

const outsideCharacters: readonly string[] = [
  ...lineBreaks.map(([, code]) => String.fromCharCode(code)),
  ' ',
  '*',
  '>',
];

export function pick<Value>(next: Next, values: readonly Value[]): Value {
  return values[Math.floor(next() * values.length)] as Value;
}

function insertedAt(next: Next, text: string, inserted: string): string {
  const index = Math.floor(next() * (text.length + 1));
  return `${text.slice(0, index)}${inserted}${text.slice(index)}`;
}

function caseFlipped(next: Next, text: string): string | undefined {
  const letters = [...text.matchAll(/[A-Za-z]/g)].map((match) => match.index);
  const index = letters.length === 0 ? undefined : pick(next, letters);
  if (index === undefined) {
    return undefined;
  }
  const flipped = text.charAt(index);
  const swapped = flipped === flipped.toUpperCase() ? flipped.toLowerCase() : flipped.toUpperCase();
  return `${text.slice(0, index)}${swapped}${text.slice(index + 1)}`;
}

function prefixDropped(prefix: string | null, text: string): string | undefined {
  if (prefix === null || !text.startsWith(prefix)) {
    return undefined;
  }
  return text.slice(prefix.length + 1);
}

/** A text changed, and whether the change writes what no printer writes: a character or a key outside every name. */
export type Mutated = { readonly text: string; readonly isUnprintable: boolean };

/** One of the mutations of one text site of a plan under a prefix, or nothing when the one drawn does not apply to it. */
export function mutatedOf(next: Next, site: TextSite, prefix: string | null): Mutated | undefined {
  const mutations: readonly (() => Mutated | undefined)[] = [
    () => ({
      text: insertedAt(next, site.text, pick(next, outsideCharacters)),
      isUnprintable: true,
    }),
    () => ({ text: insertedAt(next, site.text, pick(next, ['.', '_'])), isUnprintable: false }),
    () => withIf(caseFlipped(next, site.text), false),
    () => withIf(prefixDropped(prefix, site.text), false),
    () => ({ text: '', isUnprintable: false }),
    () => (site.isKey ? { text: '__proto__', isUnprintable: true } : undefined),
  ];
  return pick(next, mutations)();
}

function withIf(text: string | undefined, isUnprintable: boolean): Mutated | undefined {
  return text === undefined ? undefined : { text, isUnprintable };
}

/** What a site's text is built from, read from where the site sits in the plan. */
type SiteKind = 'stream' | 'durable-consumer' | 'service' | 'subject' | 'other';

function siteKindOf({ path, isKey }: TextSite): SiteKind {
  const [listing, , field] = path;
  if (isKey) {
    return listing === 'streams' ? 'stream' : 'durable-consumer';
  }
  switch (field) {
    case 'service':
      return 'service';
    case 'stream':
      return 'stream';
    case 'subject':
    case 'subjects':
      return 'subject';
    default:
      return 'other';
  }
}

const kebabNameOf = (next: Next) => drawnName(next, 'kebab');

function kebabOf(camel: string): string {
  return camel.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** A text with one of the names it is built from replaced by another the grammars accept, or nothing when the site has no name to replace. */
export function partReplacedOf(
  next: Next,
  site: TextSite,
  prefix: string | null,
): string | undefined {
  switch (siteKindOf(site)) {
    case 'service':
      return kebabNameOf(next);
    case 'stream':
      return `${prefix === null ? '' : `${prefix}_`}${kebabNameOf(next)}`;
    case 'subject':
      return subjectPartReplaced(next, site.text, prefix);
    case 'durable-consumer':
      return durableConsumerPartReplaced(next, site.text, prefix);
    case 'other':
      return kebabNameOf(next);
  }
}

function subjectPartReplaced(next: Next, text: string, prefix: string | null): string {
  const head = prefix === null ? '' : `${prefix}.`;
  const parts = text.slice(head.length).split('.');
  const replacements = [
    kebabNameOf(next),
    parts[1] === 'event' ? 'command' : 'event',
    drawnName(next, 'pascal'),
    `v${drawnVersion(next)}`,
  ];
  const index = Math.floor(next() * replacements.length);
  return `${head}${parts.map((part, at) => (at === index ? replacements[at] : part)).join('.')}`;
}

function durableConsumerPartReplaced(next: Next, text: string, prefix: string | null): string {
  const head = prefix === null ? '' : `${prefix}_`;
  const [service = '', ...tail] = text.slice(head.length).split('_');
  if (next() < 0.4) {
    return `${head}${kebabNameOf(next)}_${tail.join('_')}`;
  }
  if (tail[0] !== 'command') {
    return `${head}${service}_${kebabOf(drawnName(next, 'camel'))}`;
  }
  const replaced =
    next() < 0.5 ? [drawnName(next, 'pascal'), tail[2]] : [tail[1], `v${drawnVersion(next)}`];
  return `${head}${service}_command_${replaced.join('_')}`;
}

/** The sites of a plan whose text is a subject. */
export function subjectSitesOf(sites: readonly TextSite[]): readonly TextSite[] {
  return sites.filter((site) => siteKindOf(site) === 'subject');
}
