// Verifies the built site against the public web SEO/GEO baseline:
// page metadata, Open Graph and Twitter cards, crawler files, llms.txt,
// structured data, and the social image. Run after `vite build`.
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const dist = resolve(process.argv[2] ?? 'dist');
const SOCIAL_IMAGE = 'https://hermawan22.github.io/varendo/og-image.png';
const ORIGINS = ['https://hermawan22.github.io/varendo', 'https://hermawan22.github.io/varendo'];
const NOT_FOUND_PAGES = new Set(['404.html', '404/index.html']);
const failures = [];

const fail = (message) => failures.push(message);
const read = (name, encoding) =>
  readFile(join(dist, name), encoding).catch(() => {
    fail(`${name}: missing from the build`);
    return undefined;
  });
const attribute = (html, pattern) => html.match(pattern)?.[1];
const meta = (html, key, name) => attribute(html, new RegExp(`<meta\\s+${key}="${name}"\\s+content="([^"]*)"`, 'u'));

async function htmlFiles(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => relative(dist, join(entry.parentPath, entry.name)));
}

function checkPage(file, html) {
  const title = attribute(html, /<title>([^<]+)<\/title>/u);
  const canonical = attribute(html, /<link\s+rel="canonical"\s+href="([^"]+)"/u);
  const required = {
    title,
    description: meta(html, 'name', 'description'),
    canonical,
    'og:title': meta(html, 'property', 'og:title'),
    'og:description': meta(html, 'property', 'og:description'),
    'og:url': meta(html, 'property', 'og:url'),
    'twitter:title': meta(html, 'name', 'twitter:title'),
    'twitter:description': meta(html, 'name', 'twitter:description'),
  };
  for (const [name, value] of Object.entries(required)) if (!value?.trim()) fail(`${file}: missing ${name}`);
  if (canonical && !ORIGINS.some((origin) => canonical.startsWith(`${origin}/`)))
    fail(`${file}: canonical ${canonical} is not on a public origin`);
  if (canonical && required['og:url'] !== canonical) fail(`${file}: og:url does not match the canonical URL`);
  if (meta(html, 'property', 'og:image') !== SOCIAL_IMAGE) fail(`${file}: og:image must be ${SOCIAL_IMAGE}`);
  if (meta(html, 'name', 'twitter:image') !== SOCIAL_IMAGE) fail(`${file}: twitter:image must be ${SOCIAL_IMAGE}`);
  if (meta(html, 'name', 'twitter:card') !== 'summary_large_image')
    fail(`${file}: twitter:card must be summary_large_image`);
  return canonical;
}

function checkStructuredData(html) {
  const source = attribute(html, /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/u);
  if (source === undefined) return fail('index.html: missing JSON-LD');
  const types = JSON.parse(source)['@graph']?.map((entity) => entity['@type']) ?? [];
  for (const type of ['Organization', 'WebSite', 'SoftwareApplication'])
    if (!types.includes(type)) fail(`index.html: JSON-LD has no ${type}`);
}

async function checkSocialImage() {
  const png = await read('og-image.png');
  if (png === undefined) return;
  const signature = png.subarray(1, 4).toString('latin1');
  if (signature !== 'PNG') return fail('og-image.png: not a PNG file');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== 1200 || height !== 630) fail(`og-image.png: ${width}x${height}, want 1200x630`);
}

async function checkHostFiles(host, canonicalUrls) {
  const robots = (await read(`robots-${host}.txt`, 'utf8')) ?? '';
  const sitemap = (await read(`sitemap-${host}.xml`, 'utf8')) ?? '';
  const llms = (await read(`llms-${host}.txt`, 'utf8')) ?? '';
  const origin = host === 'docs' ? 'https://hermawan22.github.io/varendo' : 'https://hermawan22.github.io/varendo';
  if (!robots.includes(`Sitemap: ${origin}/sitemap.xml`)) fail(`robots-${host}.txt: missing Sitemap line`);
  if (!/^# .+\n\n> .+/u.test(llms)) fail(`llms-${host}.txt: needs an H1 title and a summary blockquote`);
  const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => match[1]);
  for (const url of listed) {
    if (!canonicalUrls.has(url)) fail(`sitemap-${host}.xml: ${url} is not a canonical page`);
    if (host === 'docs' && !llms.includes(`](${url})`)) fail(`llms-docs.txt: missing ${url}`);
  }
}

const canonicalUrls = new Set();
for (const file of await htmlFiles(dist)) {
  if (NOT_FOUND_PAGES.has(file)) continue;
  const canonical = checkPage(file, await readFile(join(dist, file), 'utf8'));
  if (canonical) canonicalUrls.add(canonical);
}
checkStructuredData((await read('index.html', 'utf8')) ?? '');
await checkSocialImage();
for (const host of ['main', 'docs']) await checkHostFiles(host, canonicalUrls);

if (failures.length > 0) {
  console.error(`SEO check failed with ${failures.length} problem(s):\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`SEO check passed for ${canonicalUrls.size} canonical pages.`);
