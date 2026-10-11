# Varendo design tokens

This guide describes the token boundary shared by the component library and
the public site. The site has one fixed palette: off-white reading surfaces,
graphite product surfaces, restrained indigo accents, and system sans-serif
type. It has no theme control or system-preference switch. Site tokens live in
[`apps/site/src/styles/base.css`](../../apps/site/src/styles/base.css) and the
related route styles.

The component library keeps host-controlled styling. Its token source is
[`design/tokens.json`](../../design/tokens.json), and
`design/generate-web-tokens.mjs` generates
[`packages/web/src/styles/tokens.ts`](../../packages/web/src/styles/tokens.ts).
Edit the token JSON and run the generator; do not edit generated CSS or TypeScript
by hand.

## Component theming

`aeliqoThemeStyles` scopes variables to a custom element's `:host`; it does not
reset the consumer document. `aeliqoStandaloneThemeStyles` scopes them to a
host-selected container marked with `data-aeliqo-theme`. The default component
palette can follow the system color preference. A consumer can select `light`,
`dark`, or `inherit` explicitly, or override semantic custom properties directly.
These options belong to applications using the component library; they do not
add a theme switch to the Varendo site.

```ts
import { css, LitElement } from 'lit';
import { aeliqoThemeStyles } from '@varendo/web/styles';

export class ExampleElement extends LitElement {
  static styles = [
    aeliqoThemeStyles,
    css`
      :host {
        display: block;
      }
    `,
  ];
}
```

Host applications may set `data-aeliqo-theme="dark"` or
`data-aeliqo-theme="light"` on the component or on a container using
`aeliqoStandaloneThemeStyles`. Use `inherit` when an element should inherit the
container's tokens without selecting a new palette. Prefer semantic roles such
as canvas, surface, text, border, focus, accent, and status colors over a fixed
component color. Existing family-specific variables such as
`--aeliqo-input-*`, `--aeliqo-table-*`, and `--aeliqo-chart-*` remain available
for targeted host customization.

## Interaction and direction

The generated tokens cover type, spacing, control size, focus, motion, elevation,
locale, and visualization colors. Forced-colors maps semantic roles to system
colors. Reduced-motion sets shared transition durations to zero; each component
decides whether a transition applies. Components use CSS logical properties so
RTL layouts do not need a separate stylesheet.

`createAeliqoLocaleContext` validates and canonicalizes a BCP 47 language tag.
Pass `direction` when the host must control direction explicitly; otherwise the
runtime uses `Intl.Locale.prototype.getTextInfo()` when the platform provides
it. The helper returns immutable `lang` and `dir` metadata and does not mutate
global locale state.

```ts
import { createAeliqoLocaleContext } from '@varendo/web/styles';

const locale = createAeliqoLocaleContext('ar-EG', { direction: 'rtl' });
// {lang: 'ar-EG', dir: 'rtl'}
```

Color is not the only signal for selection, validation, or chart series. Keep
labels, shapes, positions, and accessible names meaningful in each state. The
component reference documents the actual properties, states, keyboard behavior,
and styling parts for each catalog entry.

## Verification

After changing tokens or locale behavior, run:

```sh
pnpm test:design
pnpm test:design:browser
```

The full component and site acceptance also covers narrow layouts, long labels,
RTL, reduced motion, forced colors, keyboard and focus, and text reflow. A token
test or screenshot alone does not establish accessibility or browser
compatibility.
