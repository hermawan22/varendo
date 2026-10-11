import { svg } from 'lit';
import type { PlotGeometry } from './geometry.js';
import { SERIES_COLORS as colors } from './palette.js';
export const seriesColor = (g: PlotGeometry, series: string): string =>
  colors[g.series.indexOf(series) % colors.length] ?? colors[0]!;
export const seriesSymbol = (g: PlotGeometry, s: string): string =>
  ['●', '■', '▲', '◆'][g.series.indexOf(s) % 4] ?? '●';
const dash = (g: PlotGeometry, s: string): number[] =>
  [[], [6, 3], [2, 2], [8, 2, 2, 2]][g.series.indexOf(s) % 4] ?? [];
export function svgPlotMarks(geometry: PlotGeometry) {
  return geometry.marks.map((mark) => {
    const color = mark.color ?? seriesColor(geometry, mark.series);
    switch (mark.kind) {
      case 'point': {
        const r = mark.radius,
          x = mark.x,
          y = mark.y;
        switch (seriesSymbol(geometry, mark.series)) {
          case '■':
            return svg`<rect x=${x - r} y=${y - r} width=${r * 2} height=${r * 2} fill=${color}></rect>`;
          case '▲':
            return svg`<path d=${`M${x},${y - r}L${x + r},${y + r}L${x - r},${y + r}Z`} fill=${color}></path>`;
          case '◆':
            return svg`<path d=${`M${x},${y - r}L${x + r},${y}L${x},${y + r}L${x - r},${y}Z`} fill=${color}></path>`;
          default:
            return svg`<circle cx=${x} cy=${y} r=${r} fill=${color}></circle>`;
        }
      }
      case 'rect':
        return svg`<rect x=${mark.x} y=${mark.y} width=${mark.width} height=${mark.height} fill=${color}></rect>`;
      case 'path':
        return svg`<path d=${mark.path} fill=${mark.filled ? color : 'none'} fill-opacity=${mark.filled ? 0.25 : 1} stroke=${color} stroke-width="2" stroke-dasharray=${dash(geometry, mark.series).join(' ')} vector-effect="non-scaling-stroke"></path>`;
    }
  });
}
/** Canvas consumes the same bounded shapes and coordinates as SVG. It never prepares or aggregates data. */
export function paintPlotCanvas(
  context: CanvasRenderingContext2D,
  geometry: PlotGeometry,
  resolveColor: (color: string) => string,
): void {
  context.clearRect(0, 0, geometry.width, geometry.height);
  for (const mark of geometry.marks) {
    context.fillStyle = resolveColor(mark.color ?? seriesColor(geometry, mark.series));
    context.strokeStyle = context.fillStyle;
    context.lineWidth = 2;
    context.setLineDash(dash(geometry, mark.series));
    switch (mark.kind) {
      case 'point': {
        const r = mark.radius,
          x = mark.x,
          y = mark.y;
        context.beginPath();
        switch (seriesSymbol(geometry, mark.series)) {
          case '■':
            context.rect(x - r, y - r, r * 2, r * 2);
            break;
          case '▲':
            context.moveTo(x, y - r);
            context.lineTo(x + r, y + r);
            context.lineTo(x - r, y + r);
            context.closePath();
            break;
          case '◆':
            context.moveTo(x, y - r);
            context.lineTo(x + r, y);
            context.lineTo(x, y + r);
            context.lineTo(x - r, y);
            context.closePath();
            break;
          default:
            context.arc(x, y, r, 0, Math.PI * 2);
        }
        context.fill();
        break;
      }
      case 'rect':
        context.fillRect(mark.x, mark.y, mark.width, mark.height);
        break;
      case 'path': {
        const path = new Path2D(mark.path);
        if (mark.filled) {
          context.globalAlpha = 0.25;
          context.fill(path);
          context.globalAlpha = 1;
        }
        context.stroke(path);
        break;
      }
    }
  }
}
