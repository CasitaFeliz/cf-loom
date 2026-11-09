/**
 * The one timeout of every Vitest project, test and hook, and the deadline of the README write-out's
 * `tsc` and cf-loom runs: a hang bound that bounds no cost. Vitest cannot stop a synchronous test,
 * so a timeout sized from a quiet run only reads the clock after the test returns, and the CI
 * runners share their CPUs, so a test's wall time grows with the load beside it. A test that bounds
 * time asserts a ratio (C30); this value only ends what never returns.
 */
export const hangTimeout = 600_000;
