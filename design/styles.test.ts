import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AELIQO_DARK_TOKENS,
  AELIQO_LIGHT_TOKENS,
  AELIQO_SHARED_TOKENS,
  AELIQO_TOKEN_NAMES,
  getAeliqoToken,
} from '../packages/web/src/styles/tokens.js';
import {
  aeliqoLocaleAttributes,
  createAeliqoLocaleContext,
  resolveAeliqoDirection,
} from '../packages/web/src/styles/locale.js';
import { aeliqoStandaloneThemeStyles, aeliqoThemeStyles } from '../packages/web/src/styles/theme.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

function hasTextInfo(locale: string): locale is string {
  const candidate = new Intl.Locale(locale) as Intl.Locale & {
    getTextInfo?: () => { readonly direction?: string };
  };
  return typeof candidate.getTextInfo === 'function';
}

function requiredToken(map: object, name: string): string {
  const value = (map as Record<string, unknown>)[name];
  if (typeof value !== 'string') throw new Error(`Missing token ${name}`);
  return value;
}

function relativeLuminance(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Expected an opaque hex color: ${hex}`);
  const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset + 1, offset + 3), 16) / 255);
  const linear = channels.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('owned token baseline', () => {
  it('keeps generated semantic maps complete and non-empty', () => {
    const maps = [AELIQO_LIGHT_TOKENS, AELIQO_DARK_TOKENS, AELIQO_SHARED_TOKENS];
    for (const map of maps) {
      for (const [name, value] of Object.entries(map)) {
        expect(AELIQO_TOKEN_NAMES).toContain(name);
        expect(value).toEqual(expect.any(String));
        expect(value.length).toBeGreaterThan(0);
      }
    }

    expect(getAeliqoToken('light', '--aeliqo-color-text')).toBe('#111827');
    expect(getAeliqoToken('dark', '--aeliqo-color-text')).toBe('#F3F4F6');
    expect(getAeliqoToken('light', '--aeliqo-space-16')).toBe('1rem');
  });

  it('keeps the JSON source and generated output tied to the owned baseline', () => {
    const source = JSON.parse(readFileSync(resolve(root, 'design/tokens.json'), 'utf8')) as {
      readonly $extensions?: { readonly aeliqo?: { readonly sourceOfTruth?: string } };
      readonly light?: { readonly text?: { $value?: { readonly hex?: string } } };
      readonly dark?: { readonly text?: { $value?: { readonly hex?: string } } };
      readonly visualization?: {
        readonly light?: Record<string, { $value?: { readonly hex?: string } }>;
        readonly dark?: Record<string, { $value?: { readonly hex?: string } }>;
      };
    };

    expect(source.$extensions?.aeliqo?.sourceOfTruth).toBe('design/tokens.json');
    expect(() =>
      execFileSync(process.execPath, [resolve(root, 'design/generate-web-tokens.mjs'), '--check'], {
        cwd: root,
        stdio: 'pipe',
      }),
    ).not.toThrow();
    expect(source.light?.text?.$value?.hex).toBe(AELIQO_LIGHT_TOKENS['--aeliqo-color-text']);
    expect(source.dark?.text?.$value?.hex).toBe(AELIQO_DARK_TOKENS['--aeliqo-color-text']);

    const paletteNames = ['series1', 'series2', 'series3', 'series4', 'reference'];
    for (const [mode, tokens] of [
      ['light', AELIQO_LIGHT_TOKENS],
      ['dark', AELIQO_DARK_TOKENS],
    ] as const) {
      const palette = source.visualization?.[mode];
      for (const name of paletteNames) {
        expect(palette?.[name]?.$value?.hex).toBe(requiredToken(tokens, '--aeliqo-visualization-' + name));
      }
    }
  });

  it('keeps chart encodings and semantic states readable in both themes', () => {
    const chartTokens = [
      '--aeliqo-visualization-series1',
      '--aeliqo-visualization-series2',
      '--aeliqo-visualization-series3',
      '--aeliqo-visualization-series4',
      '--aeliqo-visualization-reference',
    ];
    const textTokens = ['--aeliqo-color-text', '--aeliqo-color-muted', '--aeliqo-color-danger'];
    const controlTokens = ['--aeliqo-color-focus', '--aeliqo-color-border'];
    const themes = [
      ['light', AELIQO_LIGHT_TOKENS],
      ['dark', AELIQO_DARK_TOKENS],
    ] as const;

    for (const [theme, tokens] of themes) {
      const canvas = requiredToken(tokens, '--aeliqo-color-canvas');
      for (const name of chartTokens) {
        expect(contrastRatio(requiredToken(tokens, name), canvas), `${theme} ${name}`).toBeGreaterThanOrEqual(3);
      }
      for (const name of textTokens) {
        expect(contrastRatio(requiredToken(tokens, name), canvas), `${theme} ${name}`).toBeGreaterThanOrEqual(4.5);
      }
      for (const name of controlTokens) {
        expect(contrastRatio(requiredToken(tokens, name), canvas), `${theme} ${name}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('keeps legacy custom properties out of theme defaults', () => {
    expect(aeliqoThemeStyles.cssText).not.toContain('--aeliqo-input-color:');
    expect(aeliqoThemeStyles.cssText).not.toContain('--aeliqo-table-color:');
    expect(aeliqoThemeStyles.cssText).not.toContain('--aeliqo-chart-color:');
    expect(aeliqoStandaloneThemeStyles.cssText).not.toContain('--aeliqo-input-color:');
    expect(aeliqoStandaloneThemeStyles.cssText).toContain("[data-aeliqo-theme]:not([data-aeliqo-theme='inherit'])");
    expect(aeliqoStandaloneThemeStyles.cssText).toContain("[data-aeliqo-theme='inherit']");
    expect(aeliqoStandaloneThemeStyles.cssText).toContain("[data-aeliqo-theme][dir='rtl']");
    expect(aeliqoStandaloneThemeStyles.cssText).not.toContain(":where([dir='rtl'])");
  });
});

describe('locale boundary', () => {
  it('canonicalizes valid BCP 47 tags and lets the host choose direction', () => {
    const context = createAeliqoLocaleContext('en-us', { direction: 'rtl' });
    expect(context).toEqual({ locale: 'en-US', direction: 'rtl' });
    expect(Object.isFrozen(context)).toBe(true);
    expect(aeliqoLocaleAttributes(context)).toEqual({ lang: 'en-US', dir: 'rtl' });
    expect(resolveAeliqoDirection('ar-Latn', 'ltr')).toBe('ltr');
  });

  it('rejects invalid tags and invalid runtime directions', () => {
    expect(() => createAeliqoLocaleContext('en_US', { direction: 'ltr' })).toThrow(/Invalid Varendo BCP 47 locale/);
    expect(() => createAeliqoLocaleContext('', { direction: 'ltr' })).toThrow(/non-empty BCP 47/);
    expect(() => resolveAeliqoDirection('en-US', 'sideways' as 'ltr')).toThrow(/Invalid Varendo text direction/);
  });

  it('uses platform text metadata when available and otherwise requires direction', () => {
    const cases = [
      ['ar-Latn', 'ltr'],
      ['en-Arab', 'rtl'],
      ['yi', 'rtl'],
    ] as const;

    for (const [locale, expected] of cases) {
      if (hasTextInfo(locale)) {
        expect(resolveAeliqoDirection(locale)).toBe(expected);
      } else {
        expect(() => resolveAeliqoDirection(locale)).toThrow(/provide options.direction/);
      }
    }
  });
});
