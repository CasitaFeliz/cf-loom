import type { ServerResponse } from 'node:http';
import { constants, type ServerHttp2Stream } from 'node:http2';

/** The Caller's departure, and what runs once the take ends. */
export type Departure = {
  /** Aborts when the Caller is gone before the response finished; every part of the request that must stop derives from it and is held from it until the take ends. */
  readonly closed: AbortSignal;
  /** Runs `release`, given before the take ends, once it ends, after its last chance to abort `closed`, or at once when it ended before it was taken. */
  readonly releaseAtEnd: (release: () => void) => void;
};

/** The end of a take, and how a release is given to it. */
type End = Pick<Departure, 'releaseAtEnd'> & { readonly end: () => void };

/** The end of a take: `end` runs each release given to it. */
function endOf(): End {
  const releases: (() => void)[] = [];
  return {
    end: () => {
      for (const release of releases.splice(0)) {
        release();
      }
    },
    releaseAtEnd: (release) => void releases.push(release),
  };
}

/** A departure already over when the request was taken: `closed` aborted, every release run at once. */
function departedAtTake(): Departure {
  return { closed: AbortSignal.abort(), releaseAtEnd: (release) => release() };
}

/**
 * The Caller's departure over HTTP/1.1: aborted at once when the response is already closed
 * unfinished, else when it closes so; the take ends when the response closes.
 */
export function closedDepartureOf(outgoing: ServerResponse): Departure {
  if (outgoing.destroyed && !outgoing.writableFinished) {
    return departedAtTake();
  }
  const controller = new AbortController();
  const { end, releaseAtEnd } = endOf();
  outgoing.once('close', () => {
    if (!outgoing.writableFinished) {
      controller.abort();
    }
    end();
  });
  return { closed: controller.signal, releaseAtEnd };
}

/**
 * The Caller's departure over HTTP/2: aborted when the stream is, by a reset or a lost connection
 * before the response ended, or when it closes with an error code; the take ends when the stream
 * closes.
 */
export function resetDepartureOf(stream: ServerHttp2Stream): Departure {
  if (stream.aborted || (stream.closed && isReset(stream))) {
    return departedAtTake();
  }
  const controller = new AbortController();
  const { end, releaseAtEnd } = endOf();
  stream.once('aborted', () => controller.abort());
  stream.once('close', () => {
    if (isReset(stream)) {
      controller.abort();
    }
    end();
  });
  return { closed: controller.signal, releaseAtEnd };
}

function isReset(stream: ServerHttp2Stream): boolean {
  return stream.rstCode !== constants.NGHTTP2_NO_ERROR;
}
