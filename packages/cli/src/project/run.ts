/** Where and when a command runs, and the environment npm runs with, passed in so a run depends on nothing else. */
export type Run = {
  readonly cwd: string;
  readonly now: number;
  readonly env: Readonly<Record<string, string | undefined>>;
};
