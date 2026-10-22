/** An archive that cannot be read, with the words a failure line ends with. */
export type Broken = { readonly kind: 'broken'; readonly reason: string };

/** A block that is no header, or a pax record that is no record. */
export const noArchive: Broken = { kind: 'broken', reason: 'is no tar archive' };

/** Anything but zeros after the first zero block, where npm's tar may read on. */
export const afterEnd: Broken = { kind: 'broken', reason: 'has data after its end' };

/** A header of a kind, version or number form npm does not write, which npm's tar may read otherwise. */
export const entryNotWritten: Broken = {
  kind: 'broken',
  reason: 'has a tar entry npm does not write',
};

/** A pax header that is not one pax header with a path, a modification time and a size. */
export const paxNotWritten: Broken = {
  kind: 'broken',
  reason: 'has a pax header npm does not write',
};

/** A path npm's tar leaves out or reads as another. */
export const pathNotWritten: Broken = { kind: 'broken', reason: 'has a path npm does not write' };
