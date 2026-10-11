/** Canvas is imperative: repaint when the component's inherited theme or system colors change. */
export function observePlotTheme(host: HTMLElement, repaint: () => void): () => void {
  const view = host.ownerDocument?.defaultView;
  if (!view || typeof MutationObserver !== 'function') return () => {};
  const observer = new MutationObserver(repaint);
  let ancestor: Element | null = host;
  while (ancestor) {
    observer.observe(ancestor, {
      attributes: true,
      attributeFilter: ['data-aeliqo-theme', 'data-theme', 'class', 'style'],
    });
    const root = ancestor.getRootNode();
    ancestor = ancestor.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  const queries = ['(prefers-color-scheme: dark)', '(forced-colors: active)'].map((query) => view.matchMedia(query));
  queries.forEach((query) => query.addEventListener('change', repaint));
  return () => {
    observer.disconnect();
    queries.forEach((query) => query.removeEventListener('change', repaint));
  };
}
