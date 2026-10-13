import React from 'react';
import { createComponent, type EventName } from '@lit/react';
import { VarendoPlotElement, type VarendoPlotSelectionEvent } from '@varendo/web/plot';
export const VarendoPlot = createComponent({
  react: React,
  tagName: 'varendo-plot',
  elementClass: VarendoPlotElement,
  events: { onSelectionChange: 'varendo-plot-select' as EventName<VarendoPlotSelectionEvent> },
  displayName: 'VarendoPlot',
});
