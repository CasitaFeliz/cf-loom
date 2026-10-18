/** How the tools are configured for one Service, Application or Definitions Package. */
export type Config = {
  /** The npm scope the Contract Package is published under and Definitions Packages are found in. */
  readonly scope: string;
};

/**
 * Declares the configuration of `cf-loom.config.ts`, exported as `config`, so a missing or
 * misspelled field is a type error where it is written.
 */
export function defineConfig(config: Config): Config {
  return config;
}
