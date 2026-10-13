/**
 * Small, typed index of the maintained framework recipes.
 *
 * The source paths point at executable fixtures.  Documentation and the public
 * site can use this index to link to those sources instead of maintaining a
 * second set of illustrative snippets.
 */
export interface VarendoFrameworkRecipe {
  readonly id: 'vanilla' | 'react' | 'vue' | 'next-ssr' | 'static-island';
  readonly title: string;
  readonly sourcePaths: readonly string[];
  readonly packages: readonly string[];
  readonly proves: readonly string[];
  readonly modelRequired: false;
  readonly studioRequired: false;
}

export const frameworkRecipes: readonly VarendoFrameworkRecipe[] = [
  {
    id: 'vanilla',
    title: 'Vanilla web components',
    sourcePaths: ['examples/platform/index.html', 'examples/platform/src/main.ts'],
    packages: ['@varendo/web'],
    proves: ['properties', 'typed custom events', 'native forms', 'focus'],
    modelRequired: false,
    studioRequired: false,
  },
  {
    id: 'react',
    title: 'React 19 bindings',
    sourcePaths: ['examples/platform/react.html', 'examples/platform/src/react.tsx'],
    packages: ['@varendo/react', '@varendo/web'],
    proves: ['controlled properties', 'typed events', 'shared custom elements'],
    modelRequired: false,
    studioRequired: false,
  },
  {
    id: 'vue',
    title: 'Vue 3 embedding',
    sourcePaths: ['examples/platform/vue.html', 'examples/platform/src/vue.ts'],
    packages: ['@varendo/web'],
    proves: ['shared custom elements', 'typed event bridge', 'shared renderer'],
    modelRequired: false,
    studioRequired: false,
  },
  {
    id: 'next-ssr',
    title: 'Next.js App Router SSR and hydration',
    sourcePaths: [
      'examples/next-platform/app/page.tsx',
      'examples/next-platform/app/hydrate.tsx',
      'examples/next-platform/next.config.mjs',
    ],
    packages: ['@varendo/web', '@lit-labs/ssr-client'],
    proves: ['server rendering', 'declarative shadow DOM', 'client hydration'],
    modelRequired: false,
    studioRequired: false,
  },
  {
    id: 'static-island',
    title: 'Static page with an optional Varendo island',
    sourcePaths: ['examples/vnext/islands/index.html', 'examples/vnext/islands/main.ts'],
    packages: ['@varendo/web'],
    proves: ['useful static HTML', 'optional custom-element hydration', 'no framework adapter'],
    modelRequired: false,
    studioRequired: false,
  },
] as const;
