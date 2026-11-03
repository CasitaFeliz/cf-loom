import { z } from 'zod';
import type { IdChain } from './id-chain-type.ts';

/** What a head holds besides the chain: the optional field `lost`, in the innermost object. */
type Head = { readonly lost?: true };

/** The zod head of a chain of `count` links, built anew on each call: a zod schema cannot be cloned. */
export function headOf(chain: IdChain, count: number, head: Head = {}): z.ZodType {
  switch (chain.cycle) {
    case 'own':
      return ownCycleHead(chain, count, head);
    case 'group':
      return oneCycleHead(chain, count, head);
  }
}

function ownCycleHead(
  chain: Extract<IdChain, { cycle: 'own' }>,
  count: number,
  head: Head,
): z.ZodType {
  const start = chain.startOf?.() ?? z.object({ leaf: z.string() });
  let previous: z.ZodType =
    head.lost === true ? start.extend({ lost: z.string().optional() }) : start;
  for (let index = 0; index < count; index++) {
    const before = previous;
    const link: z.ZodType = chain.linkOf(before, () => link).meta({ id: `link${index}` });
    previous = link;
  }
  return previous;
}

function oneCycleHead(
  chain: Extract<IdChain, { cycle: 'group' }>,
  count: number,
  head: Head,
): z.ZodType {
  let top: z.ZodType | undefined;
  let previous: z.ZodType = z
    .object({
      leaf: z.string(),
      ...(head.lost === true ? { lost: z.string().optional() } : {}),
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
