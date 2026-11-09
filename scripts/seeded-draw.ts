/** A draw of a number from 0 up to 1, which a test generator repeats to build what it draws. */
export type Draw = () => number;

/** A generator that draws the same sequence on every run (mulberry32). */
export function aSeededDraw(seed: number): Draw {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** One of `choices`, drawn with `draw`. */
export function pickFrom<Choice>(draw: Draw, choices: readonly Choice[]): Choice {
  return choices[Math.floor(draw() * choices.length)] as Choice;
}
