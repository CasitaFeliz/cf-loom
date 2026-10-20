/** Whether an Element still works, so it has a Handler and a Contract Package may export it: not Retired. */
export function isLive(element: { readonly lifecycle?: string | undefined }): boolean {
  return element.lifecycle !== 'retired';
}
