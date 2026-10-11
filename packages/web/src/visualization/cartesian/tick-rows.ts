const TICK_GAP = 8;
/** Matches the staggered row offset in the renderer and the lifted-label styles. */
const ROW_GAP = 44;

function fitsOneRow(ticks: readonly SVGTextElement[]): boolean {
  const boxes = ticks.map((tick) => tick.getBBox()).sort((left, right) => left.x - right.x);
  return boxes.every((box, index) => index === 0 || boxes[index - 1]!.x + boxes[index - 1]!.width + TICK_GAP <= box.x);
}

/**
 * Staggered x-axis labels are the safe default. When the measured labels fit on one row,
 * the chart marks its SVG so styles lift the offset labels back onto the first row.
 */
export function fitAxisTickRows(root: ParentNode): void {
  for (const chart of root.querySelectorAll<SVGSVGElement>('svg')) {
    const ticks = [...chart.querySelectorAll<SVGTextElement>('text.axis-x-tick')];
    const single = ticks.length > 0 && typeof ticks[0]!.getBBox === 'function' && fitsOneRow(ticks);
    chart.toggleAttribute('data-single-row-ticks', single);
    // The unused second row stays in the viewBox; pull the following content up by its rendered height.
    const scale = chart.getBoundingClientRect().height / (chart.viewBox.baseVal?.height || 1);
    const margin = single ? `${-ROW_GAP * scale}px` : '';
    if (chart.style.marginBlockEnd !== margin) chart.style.marginBlockEnd = margin;
  }
}
