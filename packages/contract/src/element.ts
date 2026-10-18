/** How far on the network an Element reaches; the route plan and the check read it. */
export type Visibility = 'public' | 'internal' | 'private';

/** Where an Element is in its life; an Element that declares none is Active. */
export type Lifecycle = 'active' | 'deprecated' | 'retired';
