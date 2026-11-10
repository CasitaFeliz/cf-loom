import { parse } from 'yaml';

/** A `vitest run` as a step writes it: through `pnpm vitest`, or through `node` on Vitest's own file, as `cli-npm` does to keep pnpm's Node folder off its `PATH`. */
const vitestRun = /\bvitest(?:\.mjs)? run\b/;

/** A `vitest run` command: the `--project` filters it passes, and the `--shard` it passes, if any. */
export type Command = { readonly filters: readonly string[]; readonly shard: string | undefined };

/** The value of an option in `command`, quoted or not, with each `${{ matrix.<key> }}` put in. */
function optionOf(
  command: string,
  option: string,
  matrix: Readonly<Record<string, string>>,
): string | undefined {
  const found = command.match(new RegExp(`--${option}[= ]\\s*(?:'([^']*)'|"([^"]*)"|(\\S+))`));
  const value = found?.[1] ?? found?.[2] ?? found?.[3];
  return value?.replace(/\$\{\{\s*matrix\.(\w+)\s*\}\}/g, (_, key) => matrix[key] ?? '');
}

/** Every `vitest run` command in `text`, one for each line it stands on, in the order they stand. */
export function commandsIn(text: string, matrix: Readonly<Record<string, string>> = {}): Command[] {
  const commands: Command[] = [];
  for (const line of text.split('\n')) {
    const at = line.search(vitestRun);
    if (at !== -1) {
      const command = line.slice(at);
      const filters = [...command.matchAll(/--project\s+(?:'([^']*)'|"([^"]*)"|(\S+))/g)];
      commands.push({
        filters: filters.map(([, single, double, bare]) => single ?? double ?? bare ?? ''),
        shard: optionOf(command, 'shard', matrix),
      });
    }
  }
  return commands;
}

/** A matrix value as text: a list entry that is itself a mapping, as `cli-npm`'s releases are, by its JSON. */
function valueText(value: unknown): string {
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/**
 * The combinations of a job's matrix: the product of its lists, none when it has no list, then
 * each `include` entry as a combination of its own. An entry that extends a combination of the lists, or an `exclude`, is
 * not expanded, and throws.
 */
export function combinationsOf(
  matrix: Readonly<Record<string, unknown>>,
): Record<string, string>[] {
  const { include = [], exclude, ...lists } = matrix;
  if (exclude !== undefined) {
    throw new Error('The matrix has an exclude, which this test does not expand.');
  }
  let combinations: Record<string, string>[] = Object.keys(lists).length === 0 ? [] : [{}];
  for (const [key, values] of Object.entries(lists)) {
    combinations = combinations.flatMap((combination) =>
      (values as unknown[]).map((value) => ({ ...combination, [key]: valueText(value) })),
    );
  }
  const product = [...combinations];
  for (const entry of include as Record<string, unknown>[]) {
    const given = Object.fromEntries(
      Object.entries(entry).map(([key, value]) => [key, valueText(value)]),
    );
    const extended = product.some((combination) =>
      Object.keys(lists).every((key) => !(key in given) || combination[key] === given[key]),
    );
    if (extended) {
      throw new Error(
        `An include entry extends a combination of the lists, which this test does not expand: ${JSON.stringify(given)}`,
      );
    }
    combinations.push(given);
  }
  return combinations;
}

/** Whether a step with the condition `condition`, a conjunction of `matrix.<key> == '<value>'`, runs for `matrix`. */
export function runsFor(condition: unknown, matrix: Readonly<Record<string, string>>): boolean {
  if (condition === undefined) {
    return true;
  }
  const terms = String(condition)
    .replace(/^\$\{\{|\}\}$/g, '')
    .split('&&');
  return terms.every((term) => {
    const tested = term.trim().match(/^matrix\.(\w+) == '([^']*)'$/);
    if (tested === null) {
      throw new Error(`The condition of a vitest step is no test of the matrix: ${condition}`);
    }
    return matrix[tested[1] ?? ''] === tested[2];
  });
}

/** One leg of a job of CI: the job's name, the values of its matrix, and the `vitest run` commands of the steps that run for them. */
export type Leg = {
  readonly job: string;
  readonly matrix: Readonly<Record<string, string>>;
  readonly commands: Command[];
};

/** The jobs of a workflow, as far as this test reads them. */
type Jobs = Record<
  string,
  { strategy?: { matrix: Record<string, unknown> }; steps: { if?: unknown; run?: unknown }[] }
>;

/** The legs of every job of CI that runs Vitest: the matrix combinations of each, with the commands of the steps whose `if` holds for it. */
export function legsOfCi(workflow: string): Leg[] {
  const legs: Leg[] = [];
  for (const [job, { strategy, steps }] of Object.entries(parse(workflow).jobs as Jobs)) {
    const vitestSteps = steps.filter(({ run }) => typeof run === 'string' && vitestRun.test(run));
    if (vitestSteps.length === 0) {
      continue;
    }
    if (strategy?.matrix === undefined) {
      throw new Error(`The job ${job} runs Vitest with no matrix, which this test does not read.`);
    }
    for (const matrix of combinationsOf(strategy.matrix)) {
      const commands = vitestSteps
        .filter((step) => runsFor(step.if, matrix))
        .flatMap((step) => commandsIn(String(step.run), matrix));
      legs.push({ job, matrix, commands });
    }
  }
  return legs;
}

/**
 * The legs of CI in their classes: the legs of one job with one `memory` value, which every other
 * matrix key either splits among legs (a `shard`) or repeats for each release of a tool (`npm`, `node`).
 */
export function legsByClass(legs: readonly Leg[]): Map<string, Leg[]> {
  const classes = new Map<string, Leg[]>();
  for (const leg of legs) {
    const key = leg.matrix.memory === undefined ? leg.job : `${leg.job} ${leg.matrix.memory}`;
    classes.set(key, [...(classes.get(key) ?? []), leg]);
  }
  return classes;
}
