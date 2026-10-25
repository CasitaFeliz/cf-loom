import type { Issue } from './parts.ts';

/** One Issue as a line of an error or a log, after what it came from: where it sits and what broke, never the received value. */
export function issueLineOf(source: string, { part, path, code, message }: Issue): string {
  return `${source}: ${[part, ...path].join('.')} ${code}: ${message}`;
}
