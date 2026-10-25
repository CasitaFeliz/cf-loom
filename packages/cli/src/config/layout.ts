import { isPlainObject } from '@cf-loom/contract/internal';
import {
  fieldRules,
  isLayoutField,
  type LayoutField,
  layoutFields,
  pathRefusalOf,
} from './layout-paths.ts';

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

function failed(message: string): LoadedLayout {
  return { kind: 'failed', message };
}
