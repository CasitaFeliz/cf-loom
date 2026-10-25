/** The Visibilities an Element may declare, as values, so the runtime repeats the type's rule. */
export const visibilities = ['public', 'internal', 'private'] as const;

/** How far on the network an Element reaches. */
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

/** The members of a union of declarations that are not Retired: the type twin of `isLive`. */
export type LiveOf<Declared> = Declared extends { readonly lifecycle: 'retired' }
  ? never
  : Declared;

/**
 * Whether a Dependency of a Service or of an Application may target an Element of a Visibility: a
 * Service's any but Private, an Application's Public only, since it runs outside the internal network.
 */
export function reaches(packageKind: 'service' | 'application', visibility: Visibility): boolean {
  switch (packageKind) {
    case 'service':
      return visibility !== 'private';
    case 'application':
      return visibility === 'public';
  }
}
