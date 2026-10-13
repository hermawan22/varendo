import { describe, expect, it } from 'vitest';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const generatedRoot = resolve(repositoryRoot, 'artifacts/site-source');
const generatedPublic = resolve(repositoryRoot, 'artifacts/site-public');

describe('static page generation', () => {
  it('publishes factual Organization, WebSite, and SoftwareApplication structured data', async () => {
    const html = await readFile(resolve(repositoryRoot, 'index.html'), 'utf8');
    const jsonLd = html.match(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/u)?.[1];
    const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/u)?.[1];
    const description = html.match(/<meta\s+name="description"\s+content="([^"]+)"/u)?.[1];

    expect(jsonLd).toBeDefined();
    expect(canonical).toBe('https://hermawan22.github.io/varendo/');
    expect(description).toBeDefined();
    if (jsonLd === undefined || description === undefined) throw new Error('Landing metadata is incomplete.');

    const structuredData = JSON.parse(jsonLd) as {
      '@context': string;
      '@graph': Array<Record<string, unknown>>;
    };
    expect(structuredData['@context']).toBe('https://schema.org');
    expect(structuredData['@graph'].map((entity) => entity['@type'])).toEqual([
      'Organization',
      'WebSite',
      'SoftwareApplication',
    ]);

    const [organization, website, application] = structuredData['@graph'];
    if (organization === undefined || website === undefined || application === undefined)
      throw new Error('Structured data graph is incomplete.');
    expect(organization).toMatchObject({
      '@id': 'https://hermawan22.github.io/varendo/#organization',
      '@type': 'Organization',
      name: 'Varendo',
      url: canonical,
      logo: 'https://hermawan22.github.io/varendo/varendo.png',
      sameAs: ['https://github.com/hermawan22/varendo', 'https://www.npmjs.com/package/@varendo/core'],
    });
    expect(website).toMatchObject({
      '@id': 'https://hermawan22.github.io/varendo/#website',
      '@type': 'WebSite',
      name: 'Varendo',
      url: canonical,
      description,
      inLanguage: 'en',
      publisher: { '@id': 'https://hermawan22.github.io/varendo/#organization' },
      mainEntity: { '@id': 'https://hermawan22.github.io/varendo/#software' },
    });
    expect(application).toMatchObject({
      '@id': 'https://hermawan22.github.io/varendo/#software',
      '@type': 'SoftwareApplication',
      name: 'Varendo',
      url: canonical,
      applicationCategory: 'DeveloperApplication',
      description: expect.stringMatching(/^An open-source TypeScript UI runtime/u),
      isAccessibleForFree: true,
      license: 'https://www.apache.org/licenses/LICENSE-2.0',
    });
    expect(application).not.toHaveProperty('offers');
    expect(application).not.toHaveProperty('softwareVersion');
  });

  it('removes stale generated source and public files before regeneration', async () => {
    const staleSource = join(generatedRoot, 'removed-route/index.html');
    const stalePublic = join(generatedPublic, 'removed-public-input.json');
    await mkdir(join(generatedRoot, 'removed-route'), { recursive: true });
    await mkdir(generatedPublic, { recursive: true });
    await writeFile(staleSource, 'stale route');
    await writeFile(stalePublic, 'stale public input');

    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        'const {generatePages}=await import("./generate-pages.mjs"); await generatePages();',
      ],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
      },
    );
    expect(result.status, result.stderr).toBe(0);

    await expect(access(staleSource)).rejects.toThrow();
    await expect(access(stalePublic)).rejects.toThrow();

    const catalog = JSON.parse(await readFile(resolve(repositoryRoot, '../../catalog/components.json'), 'utf8'));
    const ids: string[] = catalog.components.map(({ id }: { id: string }) => id);
    for (const id of ids) {
      const html = await readFile(join(generatedRoot, 'docs/components', id, 'index.html'), 'utf8');
      const navigation = html.match(/<nav aria-label="Documentation">([\s\S]*?)<\/nav>/u)?.[1];
      expect(navigation, `Missing documentation navigation for ${id}`).toBeDefined();
      expect(navigation).toContain('class="docs-component-menu" role="group" aria-label="Component pages"');
      expect(navigation?.match(/<a href="\/components\/[^"/]+\/"/gu)).toHaveLength(ids.length);
      expect(navigation).toContain(`<a href="/components/${id}/" aria-current="page">`);
      for (const catalogId of ids) expect(navigation).toContain(`href="/components/${catalogId}/"`);
    }

    const summaryOrder = (markup: string) =>
      [...markup.matchAll(/<summary>([^<]+)/gu)].map((match) => (match[1] ?? '').trim());
    const pageAt = (route: string) => readFile(join(generatedRoot, 'docs', route, 'index.html'), 'utf8');
    const navOf = async (route: string) =>
      (await pageAt(route)).match(/<nav aria-label="Documentation">([\s\S]*?)<\/nav>/u)?.[1] ?? '';
    const componentNav = await navOf('components/data.table');
    const guideNav = await navOf('guides/resources');
    const startNav = await navOf('start/what-is-varendo');
    expect(componentNav).not.toBe('');
    expect(guideNav).not.toBe('');
    expect(startNav).not.toBe('');
    // Sidebar order is identical on every page; only open state and aria-current differ.
    expect(summaryOrder(guideNav)).toEqual(summaryOrder(componentNav));
    expect(summaryOrder(startNav)).toEqual(summaryOrder(componentNav));
    for (const navigation of [componentNav, guideNav, startNav]) {
      expect(navigation.match(/<details class="docs-nav-group"/gu)).toHaveLength(3);
      expect(navigation.match(/<details class="docs-nav-group" open>/gu)).toHaveLength(1);
    }
    expect(
      [...componentNav.matchAll(/<details class="docs-nav-group"(?: open)?><summary>([^<]+)/gu)].map(
        (match) => match[1],
      ),
    ).toEqual(['Get started', 'Components', 'Advanced']);
    for (const route of ['', 'start', 'components/data.table', 'contribute']) {
      const html = await pageAt(route);
      expect(html).toContain('<a class="brand" href="https://hermawan22.github.io/varendo/"');
      expect(html).toContain('<a class="footer-brand" href="https://hermawan22.github.io/varendo/"');
      expect(html).toContain('<a href="https://hermawan22.github.io/varendo/docs/" aria-current="page">Docs</a>');
    }
    const routeMap = JSON.parse(await readFile(join(generatedPublic, 'route-map.json'), 'utf8'));
    expect(routeMap.legacyDocs['/docs/getting-started/']).toBe('/start/');
    expect(routeMap.legacyDocs['/docs/integration/']).toBe('/start/frameworks/');
    expect(routeMap.canonicalDocs).toContain('/contribute/');
    const search = JSON.parse(await readFile(join(generatedPublic, 'search-index.json'), 'utf8'));
    expect(
      search.some(
        (page: { path: string; content: string }) =>
          page.path === '/contribute/' && page.content.includes('Report abuse'),
      ),
    ).toBe(true);
    for (const page of search as { path: string }[]) {
      expect(startNav, `Unreachable documentation page ${page.path}`).toContain(`href="${page.path}"`);
    }
    const llmsMain = await readFile(join(generatedPublic, 'llms-main.txt'), 'utf8');
    const llmsDocs = await readFile(join(generatedPublic, 'llms-docs.txt'), 'utf8');
    expect(llmsMain).toMatch(/^# Varendo\n\n> /u);
    expect(llmsMain).toContain('(https://hermawan22.github.io/varendo/llms.txt)');
    expect(llmsDocs).toMatch(/^# Varendo documentation\n\n> /u);
    for (const page of search as { path: string }[])
      expect(llmsDocs, `llms.txt misses ${page.path}`).toContain(
        `](https://hermawan22.github.io/varendo${page.path === '/' ? '/docs/' : page.path})`,
      );
    const startDoc = await pageAt('start');
    expect(startDoc).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(startDoc).toContain(
      '<meta property="og:image" content="https://hermawan22.github.io/varendo/og-image.png">',
    );
    await expect(access(join(generatedPublic, 'og-image.png'))).resolves.toBeUndefined();
    const componentDoc = await pageAt('components/data.table');
    expect(componentDoc).toContain('aria-label="Breadcrumb"');
    expect(componentDoc).toContain('<a href="/components/">Components</a>');
    expect(componentDoc).toContain('class="doc-code-copy"');
    const guideDoc = await pageAt('start');
    expect(guideDoc).toContain('aria-label="Breadcrumb"');
    expect(guideDoc).toContain('class="doc-code-copy"');
    expect(guideDoc).toContain('class="tk-kw"');
  });
});
