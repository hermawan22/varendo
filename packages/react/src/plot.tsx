import React from 'react';
import { createComponent, type EventName } from '@lit/react';
import { AeliqoPlotElement, type AeliqoPlotSelectionEvent } from '@varendo/web/plot';
export const AeliqoPlot = createComponent({
  react: React,
  tagName: 'aeliqo-plot',
  elementClass: AeliqoPlotElement,
  events: { onSelectionChange: 'aeliqo-plot-select' as EventName<AeliqoPlotSelectionEvent> },
  displayName: 'AeliqoPlot',
});
