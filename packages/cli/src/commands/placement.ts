import { join } from 'node:path';
import { byCodePoint, oneOf } from '@cf-loom/contract/internal';
import { realPathOf } from '../loading/index.ts';
import {
  elementLabelOf,
  type Handled,
  type HandlerPath,
  handlerLocalOf,
  type RecordedHandler,
  recordedLabelOf,
  retiredHandledOf,
} from '../service-code/index.ts';
import { isNothingAt, type PlacedService } from './handler-files.ts';

/** A line about the file at a path, to be printed where the paths sort. */
export type PathLine = { readonly path: string; readonly line: string };

/** A recorded Handler `generate` moves to where the layout now places its Element. */
export type Move = { readonly from: string; readonly to: string; readonly element: string };

/**
 * What the recorded Handlers come to once every move is made and every line followed: the moves,
 * the lines for what only the author can decide, and the Handlers that lack a file. Inside the
 * layout only `generate` places a file, so what a line asks of the author is to delete a file or
 * to move it off its path, never to put one at a path the layout names.
 */
export type Placement = {
  readonly moves: readonly Move[];
  readonly lines: readonly PathLine[];
  readonly lacking: readonly HandlerPath[];
};

/** The recorded Handler of an Element that the layout places elsewhere, and where. */
type Moving = { readonly handler: RecordedHandler; readonly placed: HandlerPath };

/** The line `verify` prints for a Handler `generate` would move. */
export function pendingLineOf({ from, to, element }: Move): string {
  return `${from} is the Handler of ${element}, which is now ${to}: run cf-loom generate`;
}

/**
 * Reads the recorded Handlers against the layout and the disk. A recorded Handler whose file is
 * still there leaves its path unless the layout places its Element there, and a Handler whose
 * Element the layout places elsewhere arrives there; a path keeps a file when one is there that no
 * Handler leaves; an Element lacks a Handler when its path neither keeps a file nor receives one.
 * Every line is read against that picture, so a path one Handler leaves counts as free.
 */
export function placementOf(
  service: PlacedService,
  recorded: readonly RecordedHandler[],
): Placement {
  const { directory } = service.project;
  const declared = new Map(
    service.handlerPaths.map((placed) => [handlerLocalOf(placed.handled), placed]),
  );
  const standing = recorded.filter(({ path }) => !isNothingAt(join(directory, path)));
  const leaving = standing.filter((handler) => !isPlacedAt(directory, handler, declared));
  const moving = movingOf(leaving, declared);
  const keeping = keepingOf(service, new Set(leaving.map(({ path }) => path)));
  const arriving = new Set(moving.map(({ placed }) => placed.path));
  const lacking = service.handlerPaths.filter(
    ({ path }) => !keeping.has(path) && !arriving.has(path),
  );
  const retired = new Map(
    retiredHandledOf(service.snapshot).map((handled) => [handlerLocalOf(handled), handled]),
  );
  const undecided = leaving.filter(({ local }) => !declared.has(local));
  return {
    moves: moving
      .filter(({ placed }) => !keeping.has(placed.path))
      .map(moveOf)
      .sort(byFrom),
    lines: [
      ...moving.filter(({ placed }) => keeping.has(placed.path)).map(conflictLineOf),
      ...undecided.map((handler) => undecidedLineOf(handler, retired, lacking)),
    ],
    lacking,
  };
}

/** Whether the layout places a recorded Handler's Element at the path it was imported from, or at a path that is the same file. */
function isPlacedAt(
  directory: string,
  handler: RecordedHandler,
  declared: ReadonlyMap<string, HandlerPath>,
): boolean {
  const placed = declared.get(handler.local);
  return (
    placed !== undefined &&
    realPathOf(directory, placed.path) === realPathOf(directory, handler.path)
  );
}

/** The Handler paths with a file that no Handler leaves behind. */
function keepingOf(service: PlacedService, leavingPaths: ReadonlySet<string>): ReadonlySet<string> {
  const { directory } = service.project;
  const there = service.handlerPaths.filter(({ path }) => !isNothingAt(join(directory, path)));
  return new Set(there.map(({ path }) => path).filter((path) => !leavingPaths.has(path)));
}

function movingOf(
  leaving: readonly RecordedHandler[],
  declared: ReadonlyMap<string, HandlerPath>,
): readonly Moving[] {
  const moving: Moving[] = [];
  for (const handler of leaving) {
    const placed = declared.get(handler.local);
    if (placed !== undefined) {
      moving.push({ handler, placed });
    }
  }
  return moving;
}

function moveOf({ handler, placed }: Moving): Move {
  return { from: handler.path, to: placed.path, element: elementLabelOf(placed.handled) };
}

function byFrom(left: Move, right: Move): number {
  return byCodePoint(left.from, right.from);
}

/** The line for a Handler whose Element's new path holds a file `generate` cannot tell from its Handler. */
function conflictLineOf({ handler, placed }: Moving): PathLine {
  const now = `is the Handler of ${elementLabelOf(placed.handled)}, which is now ${placed.path}`;
  const line = `${handler.path} ${now}, where a file already is: delete the one that is not its Handler`;
  return { path: handler.path, line };
}

/** The line for a Handler whose Element is Retired or no longer declared, which only the author can settle. */
function undecidedLineOf(
  handler: RecordedHandler,
  retired: ReadonlyMap<string, Handled>,
  lacking: readonly HandlerPath[],
): PathLine {
  const element = retired.get(handler.local);
  const line =
    element === undefined ? goneLineOf(handler, lacking) : retiredLineOf(handler, element);
  return { path: handler.path, line };
}

function retiredLineOf(handler: RecordedHandler, retired: Handled): string {
  return `${handler.path} is the Handler of ${elementLabelOf(retired)}, which is Retired: delete it`;
}

/** The line for a Handler whose Element is no longer declared, naming the Elements that may replace it. */
function goneLineOf(handler: RecordedHandler, lacking: readonly HandlerPath[]): string {
  const replacements = lacking.filter(({ handled }) => handled.kind === handler.kind);
  const gone = `is the Handler of ${recordedLabelOf(handler)}, which is no longer declared`;
  return `${handler.path} ${gone}: ${adviceOf(replacements)}`;
}

/** What to do with a Handler whose Element is gone: delete it, or move it off its path to keep its code for the Element that replaces it. */
function adviceOf(replacements: readonly HandlerPath[]): string {
  const keep = 'delete it, or move it off its path to keep its code';
  const [only, ...others] = replacements;
  if (only === undefined) {
    return keep;
  }
  if (others.length === 0) {
    return `${keep} for ${elementLabelOf(only.handled)}`;
  }
  const candidates = replacements.map(({ handled }) => elementLabelOf(handled));
  return `${keep} for the Element that replaces it, ${oneOf(candidates)}`;
}
