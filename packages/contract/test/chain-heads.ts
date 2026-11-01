import { z } from 'zod';
import type { IdChain } from './id-chain-type.ts';

/** The zod head of a chain of `count` links, built anew on each call: a zod schema cannot be cloned. */
export function headOf(chain: IdChain, count: number): z.ZodType {
  switch (chain.cycle) {
    case 'own':
      return ownCycleHead(chain, count);
    case 'group':
      return oneCycleHead(chain, count);
  }
}

function ownCycleHead(chain: Extract<IdChain, { cycle: 'own' }>, count: number): z.ZodType {
  let previous = chain.startOf?.() ?? z.object({ leaf: z.string() });
  for (let index = 0; index < count; index++) {
    const before = previous;
    const link: z.ZodType = chain.linkOf(before, () => link).meta({ id: `link${index}` });
    previous = link;
  }
  return previous;
}

function oneCycleHead(chain: Extract<IdChain, { cycle: 'group' }>, count: number): z.ZodType {
  let top: z.ZodType | undefined;
  let previous: z.ZodType = z
    .object({
      leaf: z.string(),
      get back() {
        return top?.optional();
      },
    })
    .meta({ id: 'link0' });
  for (let index = 1; index < count; index++) {
    previous = chain.linkOf(previous).meta({ id: `link${index}` });
  }
  top = previous;
  return previous;
}
