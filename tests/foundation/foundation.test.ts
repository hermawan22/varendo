import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AELIQO_FOUNDATION_MANIFESTS,
  AELIQO_FOUNDATION_REFS,
  getAeliqoFoundationManifest,
} from '../../packages/web/src/foundation/manifest.js';
import { imageHref, initialsForName, safeResolvedHref } from '../../packages/web/src/foundation/base.js';
import { AeliqoButtonElement } from '../../packages/web/src/foundation/button.js';
import { AeliqoIconButtonElement } from '../../packages/web/src/foundation/icon-button.js';
import { AeliqoLinkElement } from '../../packages/web/src/foundation/link.js';
import { AeliqoTextElement } from '../../packages/web/src/foundation/text.js';
import { AeliqoHeadingElement } from '../../packages/web/src/foundation/heading.js';
import { AeliqoBadgeElement } from '../../packages/web/src/foundation/badge.js';
import { AeliqoAvatarElement } from '../../packages/web/src/foundation/avatar.js';
import { AeliqoSeparatorElement } from '../../packages/web/src/foundation/separator.js';
import { AeliqoSurfaceElement } from '../../packages/web/src/foundation/surface.js';
import { AeliqoStackElement } from '../../packages/web/src/foundation/stack.js';
import { AeliqoGridElement } from '../../packages/web/src/foundation/grid.js';
import { AeliqoSplitPaneElement } from '../../packages/web/src/foundation/split-pane.js';
import { AeliqoScrollAreaElement } from '../../packages/web/src/foundation/scroll-area.js';

describe('foundation manifests', () => {
  it('exposes the complete bounded foundation set with stable refs', () => {
    expect(AELIQO_FOUNDATION_MANIFESTS).toHaveLength(13);
    expect(new Set(AELIQO_FOUNDATION_MANIFESTS.map((manifest) => manifest.ref.id)).size).toBe(13);
    expect(AELIQO_FOUNDATION_MANIFESTS.map((manifest) => manifest.tagName)).toEqual([
      'aeliqo-button',
      'aeliqo-icon-button',
      'aeliqo-link',
      'aeliqo-text',
      'aeliqo-heading',
      'aeliqo-badge',
      'aeliqo-avatar',
      'aeliqo-separator',
      'aeliqo-surface',
      'aeliqo-stack',
      'aeliqo-grid',
      'aeliqo-split-pane',
      'aeliqo-scroll-area',
    ]);
    expect(getAeliqoFoundationManifest(AELIQO_FOUNDATION_REFS.button.id)?.role).toBe('action');
  });

  it('requires host registered references and rejects arbitrary executable or routing fields', () => {
    const button = getAeliqoFoundationManifest(AELIQO_FOUNDATION_REFS.button.id)!;
    expect(button.resolveConfig({ actionRef: 'action.save', contentRef: 'copy.save', type: 'submit' })).toMatchObject({
      ok: true,
    });
    expect(button.resolveConfig({ actionRef: 'action.save' })).toMatchObject({ ok: false });
    for (const value of [undefined, null, '', 42, { id: 'action.save' }]) {
      expect(button.resolveConfig({ actionRef: value, contentRef: 'copy.save' })).toMatchObject({ ok: false });
    }
    for (const value of [
      { actionRef: 'action.save', contentRef: 'copy.save', href: '/delete' },
      { actionRef: 'action.save', contentRef: 'copy.save', actor: 'admin' },
      { actionRef: 'action.save', contentRef: 'copy.save', onClick: 'alert(1)' },
      { actionRef: 'action.save', contentRef: 'copy.save', module: 'https://evil.invalid/x.js' },
      { actionRef: 'action.save', contentRef: 'copy.save', type: 'javascript' },
    ])
      expect(button.resolveConfig(value)).toMatchObject({ ok: false });

    const link = getAeliqoFoundationManifest(AELIQO_FOUNDATION_REFS.link.id)!;
    expect(
      link.resolveConfig({ routeRef: 'route.employee', contentRef: 'copy.employee', target: '_blank' }),
    ).toMatchObject({ ok: true });
    expect(
      link.resolveConfig({ routeRef: 'route.employee', contentRef: 'copy.employee', href: 'https://evil.invalid' }),
    ).toMatchObject({ ok: false });
    const text = getAeliqoFoundationManifest(AELIQO_FOUNDATION_REFS.text.id)!;
    expect(text.resolveConfig({ contentRef: 'copy.title', as: 'p', muted: false })).toMatchObject({ ok: true });
    expect(text.resolveConfig({ contentRef: 'copy.title', as: 'script' })).toMatchObject({ ok: false });
  });

  it('validates typed values and preserves immutable bounded config', () => {
    const split = getAeliqoFoundationManifest(AELIQO_FOUNDATION_REFS.splitPane.id)!;
    expect(split.resolveConfig({ orientation: 'horizontal', min: 20, max: 80, step: 5 })).toMatchObject({ ok: true });
    expect(split.resolveConfig({ position: Number.NaN })).toMatchObject({ ok: false });
    expect(split.resolveConfig({ step: 0 })).toMatchObject({ ok: false });
    expect(split.resolveConfig({ min: 80, max: 20 })).toMatchObject({ ok: false });
    expect(split.resolveConfig({ position: 10, min: 20 })).toMatchObject({ ok: false });
    const grid = getAeliqoFoundationManifest(AELIQO_FOUNDATION_REFS.grid.id)!;
    const accepted = grid.resolveConfig({ columns: 3, gap: 16, minItem: 'medium' });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(Object.isFrozen(accepted.value.values)).toBe(true);
      expect((accepted.value.values as Record<string, unknown>).columns).toBe(3);
    }
  });
});

describe('foundation helpers and import boundary', () => {
  it('can be imported in a server process without window or document', () => {
    expect(globalThis.window).toBeUndefined();
    expect(globalThis.document).toBeUndefined();
    expect(AeliqoButtonElement.formAssociated).toBe(true);
    expect([
      AeliqoIconButtonElement,
      AeliqoLinkElement,
      AeliqoTextElement,
      AeliqoHeadingElement,
      AeliqoBadgeElement,
      AeliqoAvatarElement,
      AeliqoSeparatorElement,
      AeliqoSurfaceElement,
      AeliqoStackElement,
      AeliqoGridElement,
      AeliqoSplitPaneElement,
      AeliqoScrollAreaElement,
    ]).toHaveLength(12);
  });

  it('keeps route/image schemes bounded and initials privacy-safe', () => {
    expect(safeResolvedHref('/employees/e1')).toBe('/employees/e1');
    expect(safeResolvedHref('mailto:owner@example.com')).toBe('mailto:owner@example.com');
    expect(safeResolvedHref('javascript:alert(1)')).toBeUndefined();
    expect(imageHref('data:image/svg+xml,<svg></svg>')).toBeUndefined();
    expect(initialsForName('Ada Lovelace')).toBe('AL');
    expect(initialsForName(' ')).toBe('?');
  });

  it('keeps each foundation module independent of region, planner, agent and chart code', () => {
    const root = resolve(import.meta.dirname, '../../packages/web/src/foundation');
    for (const file of [
      'base.ts',
      'button.ts',
      'icon-button.ts',
      'link.ts',
      'text.ts',
      'heading.ts',
      'badge.ts',
      'avatar.ts',
      'separator.ts',
      'surface.ts',
      'stack.ts',
      'grid.ts',
      'split-pane.ts',
      'scroll-area.ts',
    ]) {
      const source = readFileSync(resolve(root, file), 'utf8');
      expect(source).not.toMatch(/from\s+["'][^"']*(?:region|planner|agent|chart|d3|mcp)/iu);
    }
  });
});
