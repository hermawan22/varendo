import { readFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { buildPublicPages } from '../../scripts/docs/build-public-docs.mjs';
import {
  DOC_NAVIGATION,
  LEGACY_DOC_REDIRECTS,
  docsArtifactPath,
  enhanceDocCodeFigures,
  highlightDocCodePres,
} from '../../docs/public-site/routes.mjs';
import { RELEASE_VERSION } from '../../scripts/release/metadata.mjs';

const root = dirname(new URL(import.meta.url).pathname);
const siteRoot = root;
const sourceReleaseStatus = JSON.parse(readFileSync(resolve(root, '../../release-metadata.json'), 'utf8')).status;
const releaseStatus = process.env.AELIQO_EXPORT_VERIFIED_VERSION === RELEASE_VERSION ? 'stable' : sourceReleaseStatus;
if (releaseStatus !== 'candidate' && releaseStatus !== 'stable')
  throw new Error('Site release status must be candidate or stable.');
export const generatedRoot = resolve(root, 'artifacts/site-source');
export const generatedPublic = resolve(root, 'artifacts/site-public');

const escape = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const sitemap = (urls) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${escape(url)}</loc></url>`).join('')}</urlset>\n`;

const plainText = (value) =>
  value
    .replace(/<[^>]+>/gu, '')
    .replaceAll('&amp;', 'and')
    .trim();
const slug = (value) =>
  plainText(value)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/gu, '') || 'section';

function enhanceHeadings(body) {
  const headings = [];
  const used = new Map();
  const html = body.replace(/<h2(?:\s+id="([^"]+)")?>([\s\S]*?)<\/h2>/gu, (_match, existingId, label) => {
    const base = existingId || slug(label);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    const id = count === 0 ? base : `${base}-${count + 1}`;
    headings.push({ id, label: plainText(label) });
    const anchor = label.includes('<a ')
      ? ''
      : `<a class="heading-anchor" href="#${escape(id)}" aria-hidden="true" tabindex="-1">#</a>`;
    return `<h2 id="${escape(id)}">${label}${anchor}</h2>`;
  });
  return { html, headings };
}

function navItemContainsPath(item, currentPath) {
  if (item.type === 'link') return item.path === currentPath;
  if (item.type === 'component-families') return currentPath.startsWith('/components/');
  return item.items.some((link) => link.path === currentPath);
}

function navGroupContainsPath(group, currentPath) {
  return group.items.some((item) => navItemContainsPath(item, currentPath));
}

function componentMenu(pages, currentPath) {
  const families = new Map();
  for (const page of pages.filter((candidate) => candidate.component !== undefined)) {
    const family = page.section.slice('Components / '.length);
    if (!families.has(family)) families.set(family, []);
    families.get(family).push(page);
  }
  const ordered = [...families].sort(([left], [right]) => left.localeCompare(right));
  return `<div class="docs-component-menu" role="group" aria-label="Component pages">${ordered
    .map(([family, components]) => {
      const open = components.some((component) => component.path === currentPath) ? ' open' : '';
      const links = components
        .map(
          (component) =>
            `<a href="${component.path}"${component.path === currentPath ? ' aria-current="page"' : ''}>${escape(component.title)}</a>`,
        )
        .join('');
      return `<details class="docs-component-family"${open}><summary>${escape(family)} <span>${components.length}</span></summary><div class="docs-component-links">${links}</div></details>`;
    })
    .join('')}</div>`;
}

function navLinkMarkup(item, docsPages, currentPath) {
  const page = docsPages.find((candidate) => candidate.path === item.path);
  if (page === undefined) return '';
  const label = item.label ?? page.title;
  const current = page.path === currentPath ? ' aria-current="page"' : '';
  return `<a href="${page.path}"${current}>${escape(label)}</a>`;
}

function navItemMarkup(item, docsPages, currentPath) {
  if (item.type === 'link') return navLinkMarkup(item, docsPages, currentPath);
  if (item.type === 'component-families') return componentMenu(docsPages, currentPath);
  const open = navItemContainsPath(item, currentPath) ? ' open' : '';
  const links = item.items.map((link) => navLinkMarkup(link, docsPages, currentPath)).join('');
  return `<details class="docs-nav-subgroup"${open}><summary>${escape(item.label)}</summary><div class="docs-nav-links">${links}</div></details>`;
}

function docsSidebar(groups, docsPages, currentPath) {
  const links = groups
    .map((group) => {
      const open = navGroupContainsPath(group, currentPath) ? ' open' : '';
      const items = group.items.map((item) => navItemMarkup(item, docsPages, currentPath)).join('');
      return `<details class="docs-nav-group"${open}><summary>${escape(group.label)}</summary><div class="docs-nav-links">${items}</div></details>`;
    })
    .join('');
  const versionLabel = releaseStatus === 'candidate' ? 'Release candidate' : 'Current release';
  return `<aside class="docs-sidebar" aria-label="Documentation navigation"><input class="docs-nav-toggle visually-hidden" id="docs-nav-toggle" type="checkbox"><label class="docs-nav-summary" for="docs-nav-toggle">Browse documentation <span aria-hidden="true">⌄</span></label><div class="docs-sidebar-content"><a class="docs-sidebar-brand" href="/docs/"><span>Varendo</span><strong>Documentation</strong></a><a class="search-trigger" href="/search/" aria-keyshortcuts="Control+K Meta+K"><span>Search docs</span><kbd>⌘ K</kbd></a><p class="docs-version">${RELEASE_VERSION} · ${versionLabel}</p><nav aria-label="Documentation">${links}</nav><a class="docs-sidebar-github" href="https://github.com/hermawan22/varendo">View source on GitHub <span aria-hidden="true">↗</span></a></div></aside>`;
}

const SECTION_INDEX_FALLBACK = new Map([
  ['About', '/about/'],
  ['Documentation', '/search/'],
  ['Examples', '/examples/'],
]);

function docBreadcrumb(page) {
  const group = DOC_NAVIGATION.find((candidate) => navGroupContainsPath(candidate, page.path));
  const section = group?.label ?? page.section;
  const index = group?.index ?? SECTION_INDEX_FALLBACK.get(page.section);
  const sectionMarkup = index === undefined ? escape(section) : `<a href="${index}">${escape(section)}</a>`;
  return `<nav class="doc-breadcrumb" aria-label="Breadcrumb"><ol><li>${sectionMarkup}</li><li aria-current="page">${escape(page.title)}</li></ol></nav>`;
}

function docsToc(headings) {
  if (headings.length < 2) return '';
  return `<aside class="docs-toc" aria-label="Table of contents"><strong>On this page</strong><nav aria-label="On this page">${headings.map(({ id, label }) => `<a href="#${escape(id)}">${escape(label)}</a>`).join('')}</nav><a class="docs-toc-top" href="#main">Back to top ↑</a></aside>`;
}

function extractSiteShell(home) {
  const headerStart = home.indexOf('<a class="skip"');
  const mainStart = home.indexOf('<main id="main"');
  const footerStart = home.lastIndexOf('<footer');
  const scriptStart = home.indexOf('<script type="module"');
  if (headerStart < 0 || mainStart <= headerStart || footerStart < 0 || scriptStart <= footerStart)
    throw new Error(
      'The landing shell must expose a skip link, main content, footer, and module script in that order.',
    );
  const baseHeader = home.slice(headerStart, mainStart).replace(' aria-current="page"', '');
  const consentId = home.indexOf('id="analytics-consent"');
  const consentStart = consentId < 0 ? -1 : home.lastIndexOf('<div', consentId);
  const footer = home.slice(footerStart, scriptStart);
  if (consentStart < 0 || consentStart > footerStart)
    throw new Error('The site shell must expose its in-flow analytics consent banner.');
  const analyticsConsent = home.slice(consentStart, footerStart);
  return { baseHeader, footer, analyticsConsent };
}

async function loadSitePages() {
  const docs = (await buildPublicPages({ releaseStatus })).map((page) => ({ ...page, surface: 'docs' }));
  const docsPages = docs;
  const all = [...docs];
  const playground = await readFile(join(siteRoot, 'playground.html'), 'utf8');
  all.push({
    path: '/playground/',
    title: 'Playground',
    section: 'Playground',
    description: 'Evaluate and present synthetic application data with the real Varendo runtime.',
    body: playground,
    surface: 'docs',
  });
  all.push({
    path: '/404/',
    title: 'Page not found',
    section: '404',
    description: 'This page is unavailable.',
    body: '<p>The requested page could not be found.</p><p><a href="https://hermawan22.github.io/varendo/">Browse documentation</a> or <a href="https://hermawan22.github.io/varendo/">return to Varendo.</a></p>',
    surface: 'shared',
  });
  return { docs, docsPages, all };
}

function pageHeader(baseHeader, page, isDocs) {
  if (isDocs || page.path === '/playground/') {
    return baseHeader
      .replace(
        '<a href="https://hermawan22.github.io/varendo/docs/">Docs</a>',
        `<a href="https://hermawan22.github.io/varendo/docs/"${isDocs ? ' aria-current="page"' : ''}>Docs</a>`,
      )
      .replace(
        '<a href="https://hermawan22.github.io/varendo/playground/">Playground</a>',
        `<a href="/playground/"${page.path === '/playground/' ? ' aria-current="page"' : ''}>Playground</a>`,
      );
  }
  return baseHeader;
}

function pageBody(page, isDocs) {
  if (page.path === '/playground/') return { html: page.body, headings: [] };
  const enhanced = isDocs ? enhanceHeadings(page.body) : { html: page.body, headings: [] };
  const body = isDocs ? highlightDocCodePres(enhanceDocCodeFigures(enhanced.html)) : enhanced.html;
  const articleClass = ['reading', page.path === '/' ? 'docs-home' : '', page.component ? 'component-doc' : '']
    .filter(Boolean)
    .join(' ');
  const header = isDocs
    ? `<header class="doc-header">${docBreadcrumb(page)}<h1>${escape(page.title)}</h1><p class="doc-dek">${escape(page.description)}</p></header>`
    : `<header class="doc-header"><p class="eyebrow">${escape(page.section)}</p><h1>${escape(page.title)}</h1><p class="doc-dek">${escape(page.description)}</p></header>`;
  const html = `<article class="${articleClass}">${header}${body}</article>`;
  return { html, headings: enhanced.headings };
}

function pageLayout(page, isDocs) {
  if (isDocs) return 'docs-layout';
  if (page.path === '/playground/') return 'playground-layout';
  return 'content-layout';
}

function pageAttributes(page, isDocs) {
  const attributes = [];
  if (page.component) attributes.push(`data-component="${page.component}"`);
  if (isDocs) attributes.push('data-docs="true"');
  return attributes.length === 0 ? '' : ` ${attributes.join(' ')}`;
}

const SOCIAL_IMAGE = 'https://hermawan22.github.io/varendo/og-image.png';
const SOCIAL_IMAGE_ALT = 'Varendo: Ask a question. Varendo picks the view.';

function socialMeta(title, description) {
  return `<meta property="og:site_name" content="Varendo"><meta property="og:image" content="${SOCIAL_IMAGE}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${escape(SOCIAL_IMAGE_ALT)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(description)}"><meta name="twitter:image" content="${SOCIAL_IMAGE}"><meta name="twitter:image:alt" content="${escape(SOCIAL_IMAGE_ALT)}">`;
}

function pageDocument(page, shell, docsPages) {
  const isDocs = page.surface === 'docs' && page.path !== '/playground/';
  const content = pageBody(page, isDocs);
  const navigation = isDocs ? docsSidebar(DOC_NAVIGATION, docsPages, page.path) : '';
  const toc = isDocs ? docsToc(content.headings) : '';
  const header = pageHeader(shell.baseHeader, page, isDocs);
  const layout = pageLayout(page, isDocs);
  const canonicalPath = page.surface === 'docs' && page.path === '/' ? '/docs/' : page.path;
  const canonicalUrl = `https://hermawan22.github.io/varendo${canonicalPath}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(page.title)} — Varendo</title><meta name="description" content="${escape(page.description)}"><link rel="canonical" href="${escape(canonicalUrl)}"><meta property="og:title" content="${escape(page.title)} — Varendo"><meta property="og:description" content="${escape(page.description)}"><meta property="og:url" content="${escape(canonicalUrl)}"><meta property="og:type" content="website">${socialMeta(`${page.title} — Varendo`, page.description)}<link rel="icon" href="/aeliqo.png"><link rel="stylesheet" href="/src/site.css"></head><body${pageAttributes(page, isDocs)}>${header}${shell.analyticsConsent}<main id="main" class="shell ${layout}" tabindex="-1">${navigation}${content.html}${toc}</main>${shell.footer}<script type="module" src="/src/site.ts"></script></body></html>`;
}

async function writeGeneratedPages(all, shell, docsPages) {
  const inputs = [join(generatedRoot, 'index.html')];
  for (const page of all) {
    const artifactPath =
      page.surface === 'docs' && page.path !== '/playground/' ? docsArtifactPath(page.path) : page.path;
    const target = join(generatedRoot, artifactPath, 'index.html');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, pageDocument(page, shell, docsPages));
    inputs.push(target);
  }
  return inputs;
}

async function writeSearchIndex(docs) {
  await writeFile(
    join(generatedPublic, 'search-index.json'),
    JSON.stringify(
      docs.map(({ path, title, description, body }) => ({ path, title, description, content: plainText(body) })),
    ),
  );
}

async function writeRouteMap(docs, all) {
  await writeFile(
    join(generatedPublic, 'route-map.json'),
    JSON.stringify({
      // Every generated documentation artifact lives under /docs internally.
      // Keep those filesystem paths as explicit legacy aliases so the landing
      // host can never serve a documentation page directly.  The docs host
      // also uses these aliases to canonicalize old /docs/* links.
      legacyDocs: {
        ...LEGACY_DOC_REDIRECTS,
        '/docs': '/',
        ...Object.fromEntries(docs.map((page) => [docsArtifactPath(page.path), page.path])),
      },
      canonicalDocs: all.filter((page) => page.surface === 'docs').map((page) => page.path),
    }),
  );
}

async function writeSitemaps(all) {
  const docsUrls = all
    .filter((page) => page.surface === 'docs')
    .map((page) => `https://hermawan22.github.io/varendo${page.path === '/' ? '/docs/' : page.path}`);
  await writeFile(join(generatedPublic, 'sitemap-main.xml'), sitemap(['https://hermawan22.github.io/varendo/']));
  await writeFile(join(generatedPublic, 'sitemap-docs.xml'), sitemap(docsUrls));
  await writeFile(
    join(generatedPublic, 'robots-main.txt'),
    'User-agent: *\nAllow: /\nSitemap: https://hermawan22.github.io/varendo/sitemap.xml\n',
  );
  await writeFile(
    join(generatedPublic, 'robots-docs.txt'),
    'User-agent: *\nAllow: /\nSitemap: https://hermawan22.github.io/varendo/sitemap.xml\n',
  );
}

const LLMS_SUMMARY =
  '> Varendo is an Apache-2.0 TypeScript UI runtime. Describe your data once; a button, your code, or an optional AI agent (MCP, WebMCP, or a bring-your-own-key model) sends a small typed intent. Varendo validates it and renders a registered view, such as a table, cards, a chart, or a detail, that fits the answer and the available space. The host application owns data, permissions, routes, and business effects. Varendo needs no account, hosted backend, or model call.';

function llmsMain() {
  return `# Varendo\n\n${LLMS_SUMMARY}\n\n## Start\n\n- [Documentation](https://hermawan22.github.io/varendo/docs/): Guides, the component catalog, and API reference.\n- [Quickstart](https://hermawan22.github.io/varendo/start/): One React dataset, four questions, four views.\n- [Playground](https://hermawan22.github.io/varendo/playground/): Run the real runtime on synthetic data in the browser.\n- [Source on GitHub](https://github.com/hermawan22/varendo): Apache-2.0 source, issues, and releases.\n\n## Optional\n\n- [Documentation index for language models](https://hermawan22.github.io/varendo/llms.txt): Every documentation page with a one-line summary.\n`;
}

function navigationPaths(item, docsPages) {
  if (item.type === 'link') return [item.path];
  if (item.type === 'component-families')
    return docsPages
      .filter((page) => page.component !== undefined)
      .sort((left, right) => left.title.localeCompare(right.title))
      .map((page) => page.path);
  return item.items.map((link) => link.path);
}

function llmsLink(page) {
  return `- [${page.title}](https://hermawan22.github.io/varendo${page.path === '/' ? '/docs/' : page.path}): ${page.description}`;
}

function llmsDocs(all) {
  const docsPages = all.filter((page) => page.surface === 'docs');
  const byPath = new Map(docsPages.map((page) => [page.path, page]));
  const listed = new Set();
  const sections = DOC_NAVIGATION.map((group) => {
    const pages = group.items
      .flatMap((item) => navigationPaths(item, docsPages))
      .filter((path) => byPath.has(path) && !listed.has(path));
    for (const path of pages) listed.add(path);
    return `## ${group.label}\n\n${pages.map((path) => llmsLink(byPath.get(path))).join('\n')}`;
  });
  const rest = docsPages.filter((page) => !listed.has(page.path)).map(llmsLink);
  const more = rest.length === 0 ? '' : `\n\n## More\n\n${rest.join('\n')}`;
  return `# Varendo documentation\n\n${LLMS_SUMMARY}\n\n${sections.join('\n\n')}${more}\n`;
}

async function writeLlmsFiles(all) {
  await writeFile(join(generatedPublic, 'llms-main.txt'), llmsMain());
  await writeFile(join(generatedPublic, 'llms-docs.txt'), llmsDocs(all));
}

export async function generatePages() {
  await rm(generatedRoot, { recursive: true, force: true });
  await rm(generatedPublic, { recursive: true, force: true });
  await mkdir(generatedRoot, { recursive: true });
  await mkdir(generatedPublic, { recursive: true });
  const releaseNote =
    releaseStatus === 'stable'
      ? `Try the local demo with synthetic data. The React starter uses the published ${RELEASE_VERSION} packages.`
      : 'Local demo with synthetic data. See the quickstart for installation and release status.';
  const home = (await readFile(join(siteRoot, 'index.html'), 'utf8')).replace('{{AELIQO_RELEASE_NOTE}}', releaseNote);
  await writeFile(join(generatedRoot, 'index.html'), home);
  await copyFile(join(siteRoot, 'public/aeliqo.png'), join(generatedPublic, 'aeliqo.png'));
  await copyFile(join(siteRoot, 'public/og-image.png'), join(generatedPublic, 'og-image.png'));
  const shell = extractSiteShell(home);
  const { docs, docsPages, all } = await loadSitePages();
  const inputs = await writeGeneratedPages(all, shell, docsPages);
  await writeSearchIndex(docs);
  await writeRouteMap(docs, all);
  await writeSitemaps(all);
  await writeLlmsFiles(all);
  return inputs;
}
