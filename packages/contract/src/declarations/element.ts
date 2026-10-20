/** The Visibilities an Element may declare, as values, so the runtime repeats the type's rule. */
export const visibilities = ['public', 'internal', 'private'] as const;

/** How far on the network an Element reaches; the route plan and the check read it. */
export type Visibility = (typeof visibilities)[number];

/** The lifecycles an Element may declare, as values, so the runtime repeats the type's rule. */
export const lifecycles = ['active', 'deprecated', 'retired'] as const;

/** Where an Element is in its life; an Element that declares none is Active. */
export type Lifecycle = (typeof lifecycles)[number];

/** The Visibilities an Event may declare, as values, so the runtime repeats the type's rule. */
export const eventVisibilities = ['internal', 'private'] as const;

/** How far an Event reaches: never Public, since a Message travels only through the broker. */
export type EventVisibility = (typeof eventVisibilities)[number];

/** An Element's lifecycle: the one it declares, or Active when it leaves it out. */
export function lifecycleOf(element: { readonly lifecycle?: Lifecycle | undefined }): Lifecycle {
  return element.lifecycle === undefined ? 'active' : element.lifecycle;
}

/** Whether an Element still works, so it has a Handler and a Contract Package may export it: not Retired. */
export function isLive(element: { readonly lifecycle?: string | undefined }): boolean {
  return element.lifecycle !== 'retired';
}
