import { join } from 'node:path';
import { byCodePoint, oneOf } from '@cf-loom/contract/internal';
import { realPathOf } from '../loading/index.ts';
import {
  type Handled,
  type HandlerPath,
  handledLabelOf,
  handlerLocalOf,
  type RecordedHandler,
  recordedLabelOf,
  retiredHandledOf,
} from '../service-code/index.ts';
import { isNothingAt, type PlacedService } from './handler-files.ts';

/** A line about the file at a path, to be printed where the paths sort. */
export type PathLine = { readonly path: string; readonly line: string };

/** A recorded Handler `generate` moves to where the layout now places its declaration. */
export type Move = { readonly from: string; readonly to: string; readonly label: string };

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

/** The recorded Handler of a declaration that the layout places elsewhere, and where. */
type Moving = { readonly handler: RecordedHandler; readonly placed: HandlerPath };

/** The line `verify` prints for a Handler `generate` would move. */
export function pendingLineOf({ from, to, label }: Move): string {
  return `${from} is the Handler of ${label}, which is now ${to}: run cf-loom generate`;
}

/**
 * Reads the recorded Handlers against the layout and the disk. A recorded Handler whose file is
 * still there leaves its path unless the layout places its declaration there, and a Handler whose
 * declaration the layout places elsewhere arrives there; a path keeps a file when one is there that no
 * Handler leaves; a declaration lacks a Handler when its path neither keeps a file nor receives one.
 * Every line is read against that picture, so a path one Handler leaves counts as free.
 */
export function placementOf(
  service: PlacedService,
  recorded: readonly RecordedHandler[],
): Placement {
  const { directory } = service.project;
  const identityOf = (path: string) => realPathOf(directory, path);
  const declared = new Map(
    service.handlerPaths.map((placed) => [handlerLocalOf(placed.handled), placed]),
  );
  const standing = recorded.filter(({ path }) => !isNothingAt(join(directory, path)));
  const leaving = standing.filter((handler) => !isPlacedAt(handler, declared, identityOf));
  const moving = movingOf(leaving, declared);
  const { keeping, lacking } = pictureOf(service, { leaving, moving }, identityOf);
  const isKept = ({ placed }: Moving) => keeping.has(identityOf(placed.path));
  const undecided = leaving.filter(({ local }) => !declared.has(local));
  return {
    moves: moving
      .filter((move) => !isKept(move))
      .map(moveOf)
      .sort(byFrom),
    lines: [
      ...moving.filter(isKept).map(conflictLineOf),
      ...undecided.map((handler) => undecidedLineOf(service, handler, lacking)),
    ],
    lacking,
  };
}

/**
 * The files that keep a Handler once every move is made, and the Handlers that lack one: a
 * declaration lacks a Handler when its file neither keeps one nor receives one.
 */
function pictureOf(
  service: PlacedService,
  {
    leaving,
    moving,
  }: { readonly leaving: readonly RecordedHandler[]; readonly moving: readonly Moving[] },
  identityOf: Identity,
): { readonly keeping: ReadonlySet<string>; readonly lacking: readonly HandlerPath[] } {
  const keeping = keepingOf(
    service,
    new Set(leaving.map(({ path }) => identityOf(path))),
    identityOf,
  );
  const arriving = new Set(moving.map(({ placed }) => identityOf(placed.path)));
  const lacking = service.handlerPaths.filter(
    ({ path }) => !keeping.has(identityOf(path)) && !arriving.has(identityOf(path)),
  );
  return { keeping, lacking };
}

/** A path as the file it is, so two spellings of one file are one. */
type Identity = (path: string) => string;

/** Whether the layout places a recorded Handler's declaration at the file it was imported from. */
function isPlacedAt(
  handler: RecordedHandler,
  declared: ReadonlyMap<string, HandlerPath>,
  identityOf: Identity,
): boolean {
  const placed = declared.get(handler.local);
  return placed !== undefined && identityOf(placed.path) === identityOf(handler.path);
}

/** The files of the Handler paths that have a file no Handler leaves behind, by identity. */
function keepingOf(
  service: PlacedService,
  leaving: ReadonlySet<string>,
  identityOf: Identity,
): ReadonlySet<string> {
  const { directory } = service.project;
  const there = service.handlerPaths.filter(({ path }) => !isNothingAt(join(directory, path)));
  return new Set(there.map(({ path }) => identityOf(path)).filter((file) => !leaving.has(file)));
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
  return { from: handler.path, to: placed.path, label: handledLabelOf(placed.handled) };
}

function byFrom(left: Move, right: Move): number {
  return byCodePoint(left.from, right.from);
}

/** The line for a Handler whose declaration's new path holds a file `generate` cannot tell from its Handler. */
function conflictLineOf({ handler, placed }: Moving): PathLine {
  const now = `is the Handler of ${handledLabelOf(placed.handled)}, which is now ${placed.path}`;
  const line = `${handler.path} ${now}, where a file already is: delete the one that is not its Handler`;
  return { path: handler.path, line };
}

/** The line for a Handler whose declaration is Retired or no longer declared, which only the author can settle. */
function undecidedLineOf(
  service: PlacedService,
  handler: RecordedHandler,
  lacking: readonly HandlerPath[],
): PathLine {
  const retired = retiredHandledOf(service.snapshot).find(
    (handled) => handlerLocalOf(handled) === handler.local,
  );
  const line =
    retired === undefined ? goneLineOf(handler, lacking) : retiredLineOf(handler, retired);
  return { path: handler.path, line };
}

function retiredLineOf(handler: RecordedHandler, retired: Handled): string {
  return `${handler.path} is the Handler of ${handledLabelOf(retired)}, which is Retired: delete it`;
}

/** The line for a Handler whose declaration is no longer declared, naming the declarations that may replace it. */
function goneLineOf(handler: RecordedHandler, lacking: readonly HandlerPath[]): string {
  const replacements = lacking.filter(({ handled }) => handled.kind === handler.kind);
  const gone = `is the Handler of ${recordedLabelOf(handler)}, which is no longer declared`;
  return `${handler.path} ${gone}: ${adviceOf(replacements)}`;
}

/** What to do with a Handler whose declaration is gone: delete it, or move it off its path to keep its code for the declaration that replaces it. */
function adviceOf(replacements: readonly HandlerPath[]): string {
  const keep = 'delete it, or move it off its path to keep its code';
  const [only, ...others] = replacements;
  if (only === undefined) {
    return keep;
  }
  if (others.length === 0) {
    return `${keep} for ${handledLabelOf(only.handled)}`;
  }
  const candidates = replacements.map(({ handled }) => handledLabelOf(handled));
  return `${keep} for the declaration that replaces it, ${oneOf(candidates)}`;
}
