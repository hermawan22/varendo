'use client';
import { useEffect } from 'react';

/** The host listens for proposals before registering the SSR custom element. */
export function HydrateVarendo() {
  useEffect(() => {
    let disposed = false;
    const root = document.getElementById('varendo-server-proof');
    const accept = (event: Event) => {
      if (!(event instanceof CustomEvent) || !(event.target instanceof HTMLElement)) return;
      const detail: unknown = event.detail;
      if (typeof detail !== 'object' || detail === null || !('value' in detail) || typeof detail.value !== 'string')
        return;
      if ('value' in event.target) event.target.value = detail.value;
    };
    root?.addEventListener('varendo-input-change', accept);
    async function hydrate() {
      await import('@lit-labs/ssr-client/lit-element-hydrate-support.js');
      const { registerVarendoElements } = await import('@varendo/web');
      if (!disposed) registerVarendoElements();
    }
    void hydrate().catch((error) => {
      if (root && !disposed) root.dataset.hydrationError = String(error);
    });
    return () => {
      disposed = true;
      root?.removeEventListener('varendo-input-change', accept);
    };
  }, []);
  return null;
}
