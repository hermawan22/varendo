const token = (name: string, fallback: string): string => `var(--aeliqo-visualization-${name}, ${fallback})`;
export const QUANTITATIVE_COLOR_START = token('quantitative-start', '#647dcc');
export const QUANTITATIVE_COLOR_END = token('quantitative-end', '#4338ca');
export const SERIES_COLORS = ['#4338ca', '#0f766e', '#b45309', '#be185d', '#0369a1', '#7e22ce'].map((color, index) =>
  token(`series${index + 1}`, color),
);

/** Geometry keeps a theme-independent color expression shared by marks and the key. */
export function quantitativeColor(ratio: number): string {
  const bounded = Math.min(1, Math.max(0, ratio));
  return `color-mix(in srgb, ${QUANTITATIVE_COLOR_START} ${(1 - bounded) * 100}%, ${QUANTITATIVE_COLOR_END})`;
}

/** Canvas accepts CSS colors, but custom properties must resolve against the component host. */
export function canvasPlotColor(color: string, style: CSSStyleDeclaration): string {
  return color.replace(
    /var\((--aeliqo-visualization-[a-z0-9-]+), ([^)]+)\)/g,
    (_match, name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback,
  );
}
