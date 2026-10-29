import type { Closed } from '@cf-loom/contract/internal';

/** How the tools are configured for one Service; a project without `cf-loom.config.ts` takes every default. */
export type Config = {
  /**
   * Where a Service's Handler files and the files `generate` regenerates live; a field left out
   * keeps its default. Only a Service has one.
   */
  readonly layout?: Layout;
};

/**
 * Where a Service's Handlers and generated files live, each a path from the project's directory
 * under `src/`, so the Service's own code, not the CLI, decides its folders.
 */
export type Layout = {
  /** An EndpointHandler's path from `{group}` and `{name}`; `src/endpoints/{group}/{name}.handler.ts` by default. */
  readonly endpoint?: `src/${string}.handler.ts`;
  /** A GuardHandler's path from `{name}`; `src/guards/{name}.handler.ts` by default. */
  readonly guard?: `src/${string}.handler.ts`;
  /** A Command's Message Handler's path from `{group}`, `{name}` and `{version}`; `src/commands/{group}/{name}.v{version}.handler.ts` by default. */
  readonly command?: `src/${string}.handler.ts`;
  /** A Subscription's Message Handler's path from `{group}` and `{name}`, the Subscription's; `src/subscriptions/{group}/{name}.handler.ts` by default. */
  readonly subscription?: `src/${string}.handler.ts`;
  /** The Handler map's file; `src/handlers.generated.ts` by default. */
  readonly handlerMap?: `src/${string}.generated.ts`;
  /** The readers' file; `src/readers.generated.ts` by default. */
  readonly readers?: `src/${string}.generated.ts`;
};

/** `layout` in a configuration: no field a Layout does not declare. */
type LayoutField<Given> = {
  readonly layout?: Closed<
    Given extends { readonly layout?: infer Written } ? Written : unknown,
    Layout
  >;
};

/**
 * Declares the configuration of `cf-loom.config.ts`, exported as `config`, so a misspelled field
 * is a type error where it is written.
 */
export function defineConfig<const Given = unknown>(
  config: Closed<Given, Config & LayoutField<Given>>,
): Config {
  return config;
}
