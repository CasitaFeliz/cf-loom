import type { ContractDirectory } from '../contract-directory/index.ts';

/**
 * Tells the tools who approved which commit, so `check` verifies a Breaking Change Approval
 * itself; expanding teams is the source's job.
 */
export type ApprovalSource = {
  readonly approvalsOf: (commit: string) => Promise<readonly { readonly approver: string }[]>;
};

/** How the tools are configured for one Service, Application or Definitions Package. */
export type Config = {
  /** The npm scope the Contract Package is published under and Definitions Packages are found in. */
  readonly scope: string;
  /** The registry `check` and `publish` read and publish to; `generate` and `verify` run offline. */
  readonly registry?: string;
  /** How to list every Contract Package in the scope, for the dependency graph. */
  readonly directory?: ContractDirectory;
  /** Where Approvals are read, only when cf-loom should verify them itself. */
  readonly approvals?: ApprovalSource;
  /** Who may give a Breaking Change Approval: people or teams. */
  readonly approvers?: readonly string[];
  /** Whether the author of a change may approve it. */
  readonly allowSelfApproval?: boolean;
};

/**
 * Declares the configuration of `cf-loom.config.ts`, exported as `config`, so a missing or
 * misspelled field is a type error where it is written.
 */
export function defineConfig(config: Config): Config {
  return config;
}
