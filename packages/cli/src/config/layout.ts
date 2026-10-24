import { contractFolder } from '../loading/index.ts';

/** A field of the layout: a kind of Handler path, or a generated file's. */
type LayoutField = 'endpoint' | 'guard' | 'command' | 'subscription' | 'handlerMap' | 'readers';

/** The placeholders a Handler path may hold, each filled from the Element's names. */
type Placeholder = 'group' | 'name' | 'version';

/** What a Handler's file name ends with. */
export const handlerEnding = '.handler.ts';

/** What the name of a file `generate` regenerates ends with. */
export const generatedEnding = '.generated.ts';

/** What a field of the layout takes. */
type FieldRules = {
  readonly default: string;
  readonly owner: string;
  readonly placeholders: readonly Placeholder[];
  readonly ending: typeof handlerEnding | typeof generatedEnding;
};

const fieldRules: Readonly<Record<LayoutField, FieldRules>> = {
  endpoint: {
    default: 'src/endpoints/{group}/{name}.handler.ts',
    owner: "an Endpoint's Handler path",
    placeholders: ['group', 'name'],
    ending: handlerEnding,
  },
  guard: {
    default: 'src/guards/{name}.handler.ts',
    owner: "a Guard's Handler path",
    placeholders: ['name'],
    ending: handlerEnding,
  },
  command: {
    default: 'src/commands/{name}.v{version}.handler.ts',
    owner: "a Command's Handler path",
    placeholders: ['name', 'version'],
    ending: handlerEnding,
  },
  subscription: {
    default: 'src/subscriptions/{name}.handler.ts',
    owner: "a Subscription's Handler path",
    placeholders: ['name'],
    ending: handlerEnding,
  },
  handlerMap: {
    default: 'src/handlers.generated.ts',
    owner: "the Handler map's path",
    placeholders: [],
    ending: generatedEnding,
  },
  readers: {
    default: 'src/readers.generated.ts',
    owner: "the readers' path",
    placeholders: [],
    ending: generatedEnding,
  },
};

const layoutFields = Object.keys(fieldRules).filter(isLayoutField);

/** Where a Service's Handlers and generated files live, every field set. */
export type ServiceLayout = Readonly<Record<LayoutField, string>>;

/** The layout of a Service whose configuration sets none. */
export const defaultLayout: ServiceLayout = {
  endpoint: fieldRules.endpoint.default,
  guard: fieldRules.guard.default,
  command: fieldRules.command.default,
  subscription: fieldRules.subscription.default,
  handlerMap: fieldRules.handlerMap.default,
  readers: fieldRules.readers.default,
};

/**
 * The layout a configuration sets, defaults filled in, or what is wrong with it, to follow the
 * configuration file's name in a line.
 */
export type LoadedLayout =
  | { readonly kind: 'loaded'; readonly layout: ServiceLayout }
  | { readonly kind: 'failed'; readonly message: string };

/** The values a Handler path's placeholders take, by name. */
export type PlaceholderValues = Readonly<Record<string, string | number>>;

/** A placeholder, `{name}`, with the name it is written with. */
const placeholderPattern = /\{([^{}]*)\}/g;

/** The characters a path's text may hold outside its placeholders. */
const portableText = /^[a-z0-9._-]*$/;

/**
 * Checks the `layout` of a configuration, since a cast or a plain object skips `defineConfig`'s
 * types, and fills in the default of every field it leaves out.
 */
export function layoutOf(written: unknown): LoadedLayout {
  if (!isPlainObject(written)) {
    return failed(
      `layout is an object of paths, such as { endpoint: 'src/http/{group}/{name}.handler.ts' }`,
    );
  }
  const extra = Object.keys(written).find((key) => !isLayoutField(key));
  if (extra !== undefined) {
    const takes = `${layoutFields.slice(0, -1).join(', ')} and ${layoutFields.at(-1)}`;
    return failed(`layout.${extra} is no field of layout: it takes ${takes}`);
  }
  const paths: Record<LayoutField, string> = { ...defaultLayout };
  for (const field of layoutFields) {
    const path = Reflect.get(written, field);
    if (path === undefined) {
      continue;
    }
    if (typeof path !== 'string') {
      return failed(`layout.${field} is a path such as '${fieldRules[field].default}'`);
    }
    const refusal = pathRefusalOf(field, path);
    if (refusal !== undefined) {
      return failed(refusal);
    }
    paths[field] = path;
  }
  if (paths.handlerMap === paths.readers) {
    return failed(`layout.handlerMap and layout.readers are one file: ${paths.handlerMap}`);
  }
  return { kind: 'loaded', layout: paths };
}

/** A path template with its placeholders filled in from an Element's names. */
export function filledPathOf(template: string, values: PlaceholderValues): string {
  return template.replace(placeholderPattern, (_, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(`The layout holds {${name}}, which was checked at load: a bug.`);
    }
    return String(value);
  });
}

type PathRule = (field: LayoutField, path: string) => string | undefined;

/** The rules a path meets, in the order the first broken one is reported. */
const pathRules: readonly PathRule[] = [
  locationRefusalOf,
  endingRefusalOf,
  placeholderRefusalOf,
  firstSegmentRefusalOf,
  segmentRefusalOf,
  folderRefusalOf,
];

function pathRefusalOf(field: LayoutField, path: string): string | undefined {
  for (const rule of pathRules) {
    const refusal = rule(field, path);
    if (refusal !== undefined) {
      return refusal;
    }
  }
  return undefined;
}

function locationRefusalOf(field: LayoutField, path: string): string | undefined {
  if (path.startsWith('src/') && !path.startsWith(`${contractFolder}/`)) {
    return undefined;
  }
  return `layout.${field} must be under src/ and outside src/contract/: ${path}`;
}

function endingRefusalOf(field: LayoutField, path: string): string | undefined {
  const { ending } = fieldRules[field];
  return path.endsWith(ending) ? undefined : `layout.${field} must end with ${ending}: ${path}`;
}

function placeholderRefusalOf(field: LayoutField, path: string): string | undefined {
  const { owner, placeholders } = fieldRules[field];
  const taken: readonly string[] = placeholders;
  const names = [...path.matchAll(placeholderPattern)].map(([, name = '']) => name);
  const foreign = names.find((name) => !taken.includes(name));
  if (foreign === undefined) {
    return undefined;
  }
  const takes =
    placeholders.length === 0
      ? 'takes no placeholder'
      : `takes only ${placeholders.map((name) => `{${name}}`).join(' and ')}`;
  return `layout.${field} holds {${foreign}}, but ${owner} ${takes}: ${path}`;
}

/** A Group or Subscription named `contract` must never fill into `src/contract/`. */
function firstSegmentRefusalOf(field: LayoutField, path: string): string | undefined {
  const [, first = ''] = path.split('/');
  if (first.replace(placeholderPattern, '') === first) {
    return undefined;
  }
  return `layout.${field} must start with a folder or file name under src/, not a placeholder: ${path}`;
}

function segmentRefusalOf(field: LayoutField, path: string): string | undefined {
  const [, ...segments] = path.split('/');
  if (segments.every(isPortableSegment)) {
    return undefined;
  }
  return `layout.${field} has a segment that is empty, starts with a dot, or holds a character other than a-z, 0-9, -, _ and .: ${path}`;
}

/** A segment is text once placeholders count: every value a placeholder takes starts with a-z or 0-9. */
function isPortableSegment(segment: string): boolean {
  const literal = segment.replace(placeholderPattern, '');
  return segment !== '' && !segment.startsWith('.') && portableText.test(literal);
}

function folderRefusalOf(field: LayoutField, path: string): string | undefined {
  const folders = path.split('/').slice(0, -1);
  const isNamedLikeFile = (folder: string) =>
    folder.endsWith(handlerEnding) || folder.endsWith(generatedEnding);
  if (!folders.some(isNamedLikeFile)) {
    return undefined;
  }
  return `layout.${field} has a folder ending ${handlerEnding} or ${generatedEnding}: ${path}`;
}

function isPlainObject(value: unknown): value is object {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isLayoutField(key: string): key is LayoutField {
  return Object.hasOwn(fieldRules, key);
}

function failed(message: string): LoadedLayout {
  return { kind: 'failed', message };
}
