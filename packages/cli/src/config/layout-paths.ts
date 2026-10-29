import { contractFolder, isUnderContract, sourceFolder } from '../loading/index.ts';
import type { Layout } from './config.ts';

/** A field of the layout: a kind of Handler path, or a generated file's. */
export type LayoutField = keyof Layout;

/** The variables a Handler path may hold, each filled from the declaration's names. */
const variables = ['group', 'name', 'version'] as const;

type Variable = (typeof variables)[number];

/** What a Handler's file name ends with. */
export const handlerEnding = '.handler.ts';

/** What the name of a file `generate` regenerates ends with. */
export const generatedEnding = '.generated.ts';

/** What a field of the layout takes. */
type FieldRules = {
  readonly default: string;
  readonly owner: string;
  readonly variables: readonly Variable[];
  readonly ending: typeof handlerEnding | typeof generatedEnding;
};

/** Each field's default, the variables it takes and its ending, so loading and checking read one table. */
export const fieldRules: Readonly<Record<LayoutField, FieldRules>> = {
  endpoint: {
    default: 'src/endpoints/{group}/{name}.handler.ts',
    owner: "an Endpoint's Handler path",
    variables: ['group', 'name'],
    ending: handlerEnding,
  },
  guard: {
    default: 'src/guards/{name}.handler.ts',
    owner: "a Guard's Handler path",
    variables: ['name'],
    ending: handlerEnding,
  },
  command: {
    default: 'src/commands/{group}/{name}.v{version}.handler.ts',
    owner: "a Command's Handler path",
    variables: ['group', 'name', 'version'],
    ending: handlerEnding,
  },
  subscription: {
    default: 'src/subscriptions/{group}/{name}.handler.ts',
    owner: "a Subscription's Handler path",
    variables: ['group', 'name'],
    ending: handlerEnding,
  },
  handlerMap: {
    default: 'src/handlers.generated.ts',
    owner: "the Handler map's path",
    variables: [],
    ending: generatedEnding,
  },
  readers: {
    default: 'src/readers.generated.ts',
    owner: "the readers' path",
    variables: [],
    ending: generatedEnding,
  },
};

/** Every field of the layout, in the order its rules list them. */
export const layoutFields = Object.keys(fieldRules).filter(isLayoutField);

/** The values a Handler path's variables take. */
export type VariableValues = Readonly<Partial<Record<Variable, string | number>>>;

/** A variable, `{name}`, with the name it is written with. */
const variablePattern = /\{([^{}]*)\}/g;

/** The characters a path's text may hold outside its variables. */
const portableText = /^[a-z0-9._-]*$/;

/** A path template with its variables filled in from a declaration's names. */
export function filledPathOf(template: string, values: VariableValues): string {
  return template.replace(variablePattern, (_, name: string) => {
    const value = isVariable(name) ? values[name] : undefined;
    if (value === undefined) {
      throw new Error(`The layout holds {${name}}, which was checked at load: a bug.`);
    }
    return String(value);
  });
}

/** A rule a path meets: the clause a line about the path ends with when it breaks the rule. */
type PathRule = (field: LayoutField, path: string) => string | undefined;

/** The rules a path meets, in the order the first broken one is reported. */
const pathRules: readonly PathRule[] = [
  locationRefusalOf,
  endingRefusalOf,
  variableRefusalOf,
  segmentRefusalOf,
  folderRefusalOf,
  declarationRefusalOf,
];

/**
 * The first rule a path of a field breaks, as the clause that follows what the path is called in
 * a line, or none: the same rules hold for a template at load, and for a path once it is filled
 * or recorded.
 */
export function pathRefusalOf(field: LayoutField, path: string): string | undefined {
  for (const rule of pathRules) {
    const refusal = rule(field, path);
    if (refusal !== undefined) {
      return refusal;
    }
  }
  return undefined;
}

function locationRefusalOf(_field: LayoutField, path: string): string | undefined {
  if (path.startsWith(`${sourceFolder}/`) && !isUnderContract(path)) {
    return undefined;
  }
  return `must be under ${sourceFolder}/ and outside ${contractFolder}/`;
}

function endingRefusalOf(field: LayoutField, path: string): string | undefined {
  const { ending } = fieldRules[field];
  return path.endsWith(ending) ? undefined : `must end with ${ending}`;
}

function variableRefusalOf(field: LayoutField, path: string): string | undefined {
  const { owner, variables: taken } = fieldRules[field];
  const names = [...path.matchAll(variablePattern)].map(([, name = '']) => name);
  const foreign = names.find((name) => !isVariable(name) || !taken.includes(name));
  if (foreign === undefined) {
    return undefined;
  }
  const takes = taken.length === 0 ? 'takes no variable' : `takes only ${joinedOf(taken)}`;
  return `holds {${foreign}}, but ${owner} ${takes}`;
}

/** Variables as a sentence names them: `{name}`, `{name} and {version}`, `{group}, {name} and {version}`. */
function joinedOf(taken: readonly Variable[]): string {
  const written = taken.map((name) => `{${name}}`);
  const last = written.at(-1) ?? '';
  return written.length === 1 ? last : `${written.slice(0, -1).join(', ')} and ${last}`;
}

function segmentRefusalOf(_field: LayoutField, path: string): string | undefined {
  const [, ...segments] = path.split('/');
  if (segments.every(isPortableSegment)) {
    return undefined;
  }
  return 'has a segment that is empty, starts with a dot, or holds a character other than a-z, 0-9, -, _ and .';
}

/** A segment is text once variables count: every value a variable takes starts with a-z or 0-9. */
function isPortableSegment(segment: string): boolean {
  const literal = segment.replace(variablePattern, '');
  return segment !== '' && !segment.startsWith('.') && portableText.test(literal);
}

function folderRefusalOf(_field: LayoutField, path: string): string | undefined {
  const folders = path.split('/').slice(0, -1);
  const isNamedLikeFile = (folder: string) =>
    folder.endsWith(handlerEnding) || folder.endsWith(generatedEnding);
  if (!folders.some(isNamedLikeFile)) {
    return undefined;
  }
  return `has a folder ending ${handlerEnding} or ${generatedEnding}`;
}

/** TypeScript reads `x.d.handler.ts` as the declarations of `x.handler`, not as a module. */
function declarationRefusalOf(_field: LayoutField, path: string): string | undefined {
  const fileName = path.split('/').at(-1) ?? '';
  if (!fileName.includes('.d.')) {
    return undefined;
  }
  return 'has a file name holding .d., which TypeScript reads as a declaration file';
}

/** Whether a key names a field of the layout. */
export function isLayoutField(key: string): key is LayoutField {
  return Object.hasOwn(fieldRules, key);
}

function isVariable(name: string): name is Variable {
  const known: readonly string[] = variables;
  return known.includes(name);
}
