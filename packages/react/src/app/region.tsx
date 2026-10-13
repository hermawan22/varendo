import React, { useEffect, useRef, type CSSProperties } from 'react';
import type { WebRenderReceipt } from '@varendo/web/app';
import { useVarendoApp } from './context.js';

export interface VarendoRegionProps {
  readonly regionId: string;
  readonly resourceId: string;
  readonly intent?: unknown;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly onReceipt?: (receipt: WebRenderReceipt) => void;
}

/** Thin lifecycle binding around the same Web Component and runtime used by vanilla consumers. */
export function VarendoRegion({
  regionId,
  resourceId,
  intent,
  className,
  style,
  onReceipt,
}: VarendoRegionProps): React.JSX.Element {
  const app = useVarendoApp();
  const target = useRef<HTMLDivElement>(null);
  const receipt = useRef(onReceipt);
  receipt.current = onReceipt;

  useEffect(() => {
    const element = target.current;
    if (element === null) return;
    const mounted = app.mount({ target: element, regionId, resourceId });
    if (!mounted.ok) throw new Error(mounted.diagnostics.map((item) => item.message).join(' '));
    return () => {
      app.unmount(regionId);
    };
  }, [app, regionId, resourceId]);

  useEffect(() => {
    if (intent === undefined || target.current === null) return;
    const controller = new AbortController();
    void app.render({ regionId, intent, signal: controller.signal }).then(
      (outcome) => {
        try {
          receipt.current?.(outcome);
        } catch {
          // Host receipt observers must not become unhandled rejections.
        }
      },
      () => undefined,
    );
    return () => {
      controller.abort();
    };
  }, [app, intent, regionId]);

  return <div ref={target} className={className} style={style} data-varendo-react-region={regionId} />;
}
