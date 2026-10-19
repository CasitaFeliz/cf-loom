/** Where and when a command runs, passed in so a run depends on nothing else. */
export type Run = { readonly cwd: string; readonly now: number };
