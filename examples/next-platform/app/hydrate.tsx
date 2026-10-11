'use client';
import { useEffect } from 'react';

/** The host listens for proposals before registering the SSR custom element. */
export function HydrateAeliqo() {
  useEffect(() => {
    let disposed = false;
    const root = document.getElementById('aeliqo-server-proof');
    const accept = (event: Event) => {
      if (!(event instanceof CustomEvent) || !(event.target instanceof HTMLElement)) return;
      const detail: unknown = event.detail;
      if (typeof detail !== 'object' || detail === null || !('value' in detail) || typeof detail.value !== 'string')
        return;
      if ('value' in event.target) event.target.value = detail.value;
    };
    root?.addEventListener('aeliqo-input-change', accept);
    async function hydrate() {
      await import('@lit-labs/ssr-client/lit-element-hydrate-support.js');
      const { registerAeliqoElements } = await import('@varendo/web');
      if (!disposed) registerAeliqoElements();
    }
    void hydrate().catch((error) => {
      if (root && !disposed) root.dataset.hydrationError = String(error);
    });
    return () => {
      disposed = true;
      root?.removeEventListener('aeliqo-input-change', accept);
    };
  }, []);
  return null;
}
