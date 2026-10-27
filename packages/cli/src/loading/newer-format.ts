/** What a Snapshot file in a format newer than this cf-loom reads says, wherever it was read from. */
export function newerFormatTextOf(file: string, format: number): string {
  return `${file} is in format ${format}, newer than this cf-loom reads: upgrade @cf-loom/cli`;
}
