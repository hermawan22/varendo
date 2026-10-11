import { expect, it } from 'vitest';
import { AELIQO_DARK_TOKENS, AELIQO_LIGHT_TOKENS } from '../../packages/web/src/styles/tokens.js';
import { quantitativeColor } from '../../packages/web/src/plot/palette.js';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

for (const [theme, tokens] of [
  ['light', AELIQO_LIGHT_TOKENS],
  ['dark', AELIQO_DARK_TOKENS],
] as const) {
  it(`all six series and the entire quantitative ramp contrast with ${theme} canvas`, () => {
    const background = luminance(tokens['--aeliqo-color-canvas']!);
    const colors = Object.entries(tokens)
      .filter(([key]) => /visualization-(series\d|quantitative-)/.test(key))
      .map(([, color]) => color);
    expect(colors).toHaveLength(8);
    const start = tokens['--aeliqo-visualization-quantitative-start']!;
    const end = tokens['--aeliqo-visualization-quantitative-end']!;
    for (let step = 0; step <= 100; step++) {
      colors.push(
        '#' +
          [1, 3, 5]
            .map((offset) =>
              Math.round(
                parseInt(start.slice(offset, offset + 2), 16) * (1 - step / 100) +
                  (parseInt(end.slice(offset, offset + 2), 16) * step) / 100,
              )
                .toString(16)
                .padStart(2, '0'),
            )
            .join(''),
      );
    }
    for (const color of colors) {
      const value = luminance(color);
      expect((Math.max(background, value) + 0.05) / (Math.min(background, value) + 0.05), color).toBeGreaterThanOrEqual(
        3,
      );
    }
  });
}
it('quantitative colors clamp ratios and share theme endpoints', () => {
  expect(quantitativeColor(-1)).toBe(quantitativeColor(0));
  expect(quantitativeColor(2)).toBe(quantitativeColor(1));
  expect(quantitativeColor(0.5)).toContain('--aeliqo-visualization-quantitative-start');
  expect(quantitativeColor(0.5)).toContain('50%');
});
