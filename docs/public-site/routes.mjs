const route = (id, path, group, sourcePath) =>
  Object.freeze({ id, path, group, ...(sourcePath === undefined ? {} : { sourcePath }) });

export const DOC_ROUTES = Object.freeze([
  route('home', '/', 'Get started', '/docs/'),
  route('what-is', '/start/what-is-varendo/', 'Get started'),
  route('quickstart', '/start/', 'Get started', '/docs/getting-started/'),
  route('registered-app', '/start/registered-app/', 'Get started'),
  route('existing-app', '/start/existing-app/', 'Get started'),
  route('standalone', '/start/standalone-components/', 'Get started', '/docs/getting-started/standalone/'),
  route('frameworks', '/start/frameworks/', 'Get started', '/docs/integration/'),

  route('resources', '/guides/resources/', 'Guides'),
  route('data', '/guides/data/', 'Guides', '/docs/data/'),
  route('local-data', '/guides/local-data/', 'Guides', '/docs/getting-started/local/'),
  route('http-data', '/guides/http-data/', 'Guides', '/docs/getting-started/http/'),
  route('permissions', '/guides/permissions/', 'Guides'),
  route('actions', '/guides/actions/', 'Guides'),
  route('forms', '/guides/forms/', 'Guides'),
  route('navigation', '/guides/navigation/', 'Guides'),
  route('responsive', '/guides/responsive-behavior/', 'Guides'),
  route('adaptive-region', '/guides/adaptive-region/', 'Guides', '/docs/getting-started/region/'),
  route('custom-views', '/guides/custom-views/', 'Guides'),
  route('analytics', '/guides/analytics/', 'Guides'),
  route('scopes', '/guides/scopes/', 'Guides'),
  route('workspace', '/guides/workspace/', 'Guides'),

  route('agents', '/agents/', 'AI agents', '/docs/agents/'),
  route('agents-quickstart', '/agents/quickstart/', 'AI agents', '/docs/getting-started/agent/'),
  route('mcp', '/agents/mcp/', 'AI agents'),
  route('webmcp', '/agents/webmcp/', 'AI agents'),
  route('byok', '/agents/byok/', 'AI agents'),
  route('agent-recovery', '/agents/recovery/', 'AI agents'),

  route('concepts', '/concepts/', 'Reference', '/docs/concepts/'),
  route('intent', '/concepts/intent/', 'Reference'),
  route('semantics', '/concepts/semantics/', 'Reference', '/docs/meaning/'),
  route('state-ownership', '/concepts/state-ownership/', 'Reference'),
  route('safety', '/concepts/safety/', 'Reference'),

  route('components', '/components/', 'Components', '/docs/components/'),
  route('reference', '/reference/', 'Reference'),
  route('packages', '/reference/packages/', 'Reference'),
  route('app-api', '/reference/app-api/', 'Reference'),
  route('intent-schema', '/reference/intent-schema/', 'Reference'),
  route('diagnostics', '/reference/diagnostics/', 'Reference'),
  route('search', '/search/', 'Reference', '/docs/search/'),

  route('ship', '/ship/', 'Releases', '/docs/production/'),
  route('ssr', '/ship/ssr/', 'Releases'),
  route('browser-support', '/ship/browser-support/', 'Releases'),
  route('migration', '/ship/migration-0.3/', 'Releases'),
  route('migration-0-4', '/ship/migration-0.4/', 'Releases'),
  route('migration-0-5', '/ship/migration-0.5/', 'Releases'),
  route('migration-0-6', '/ship/migration-0.6/', 'Releases'),
  route('support-matrix', '/ship/support-matrix/', 'Releases'),
  route('migration-varendo', '/ship/migration-varendo/', 'Releases'),
  route('migration-varendo-0-2', '/ship/migration-varendo-0.2/', 'Releases'),
  route('release-notes', '/ship/release-notes/', 'Releases'),

  route('examples', '/examples/', 'Examples'),
  route('people-example', '/examples/people/', 'Examples'),
  route('products-example', '/examples/products/', 'Examples'),
  route('support-example', '/examples/support/', 'Examples'),
  route('knowledge-example', '/examples/knowledge/', 'Examples'),

  route('advanced', '/advanced/', 'Advanced'),
  route('contribute', '/contribute/', 'Advanced'),
  route('about', '/about/', 'About'),
  route('license', '/legal/license/', 'About'),
  route('privacy', '/legal/privacy/', 'About'),
  route('security', '/legal/security/', 'About'),
  route('support', '/legal/support/', 'About'),
]);

const bySource = new Map(
  DOC_ROUTES.filter((item) => item.sourcePath !== undefined).map((item) => [item.sourcePath, item]),
);

export function routeById(id) {
  const value = DOC_ROUTES.find((item) => item.id === id);
  if (value === undefined) throw new Error(`Unknown documentation route ${id}.`);
  return value;
}

export function canonicalDocsPath(path) {
  const exact = bySource.get(path);
  if (exact !== undefined) return exact.path;
  if (path.startsWith('/docs/components/')) return `/components/${path.slice('/docs/components/'.length)}`;
  if (path.startsWith('/docs/')) return undefined;
  return path;
}

export function docsArtifactPath(path) {
  if (path === '/') return '/docs/';
  if (!path.startsWith('/')) throw new TypeError('A documentation path must be absolute.');
  return `/docs${path}`;
}

const escapeHtml = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const unescapeCode = (value) =>
  String(value)
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');

const LANGUAGE_NAMES = {
  bash: 'Shell',
  css: 'CSS',
  dotenv: 'Environment',
  html: 'HTML',
  js: 'JavaScript',
  json: 'JSON',
  mjs: 'JavaScript',
  sh: 'Shell',
  ts: 'TypeScript',
  tsx: 'React TypeScript',
  yaml: 'YAML',
};

const SCRIPT_RULES = [
  ['com', String.raw`//[^\n]*|/\*[\s\S]*?\*/`],
  ['str', String.raw`'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|` + '`(?:[^`\\\\]|\\\\.)*`'],
  [
    'kw',
    String.raw`\b(?:abstract|as|async|await|break|case|catch|class|const|continue|declare|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|keyof|let|namespace|new|of|private|protected|public|readonly|return|satisfies|set|static|switch|throw|try|type|typeof|var|void|while|yield)\b`,
  ],
  ['lit', String.raw`\b(?:true|false|null|undefined|this|NaN|Infinity)\b`],
  ['num', String.raw`\b(?:0[xXbBoO][\dA-Fa-f_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?n?)\b`],
  ['type', String.raw`\b[A-Z][\w$]*\b`],
  ['fn', String.raw`\b[A-Za-z_$][\w$]*(?=\s*\()`],
];

const TOKEN_RULES = {
  bash: [
    ['str', String.raw`'[^'\n]*'|"(?:[^"\\]|\\.)*"`],
    ['com', String.raw`#[^\n]*`],
    ['flag', String.raw`(?:^|\s)--?[A-Za-z][\w-]*`],
    ['lit', String.raw`\$\{[^}]*\}|\$[\w#@?!*]+`],
    ['num', String.raw`\b\d+(?:\.\d+)?\b`],
    ['fn', String.raw`^[\w./~-]+(?=\s|$)`],
  ],
  css: [
    ['com', String.raw`/\*[\s\S]*?\*/`],
    ['kw', String.raw`@[\w-]+`],
    ['str', String.raw`'[^'\n]*'|"(?:[^"\\]|\\.)*"`],
    ['num', String.raw`#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:%|[a-zA-Z]+)?\b`],
    ['prop', String.raw`[a-zA-Z-]+(?=\s*:)`],
    ['tag', String.raw`[.#:*\[]?[a-zA-Z][\w-]*(?=[^{};]*\{)`],
  ],
  dotenv: [
    ['com', String.raw`#[^\n]*`],
    ['prop', String.raw`^[\w.]+(?==)`],
    ['str', String.raw`'[^'\n]*'|"(?:[^"\\]|\\.)*"`],
    ['num', String.raw`\b\d+(?:\.\d+)?\b`],
  ],
  html: [
    ['com', String.raw`<!--[\s\S]*?-->`],
    ['tag', String.raw`</?[a-zA-Z][\w-]*`],
    ['prop', String.raw`[\w-]+(?==)`],
    ['str', String.raw`'[^'\n]*'|"(?:[^"\\]|\\.)*"`],
    ['lit', String.raw`&[a-zA-Z#][\w#]*;`],
  ],
  json: [
    ['prop', String.raw`"(?:[^"\\]|\\.)*"(?=\s*:)`],
    ['str', String.raw`"(?:[^"\\]|\\.)*"`],
    ['lit', String.raw`\b(?:true|false|null)\b`],
    ['num', String.raw`-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b`],
  ],
  ts: SCRIPT_RULES,
  tsx: [SCRIPT_RULES[0], SCRIPT_RULES[1], ['tag', String.raw`</?[a-zA-Z][\w.:-]*`], ...SCRIPT_RULES.slice(2)],
  yaml: [
    ['com', String.raw`#[^\n]*`],
    ['prop', String.raw`[\w.-]+(?=\s*:)`],
    ['str', String.raw`'[^'\n]*'|"(?:[^"\\]|\\.)*"`],
    ['lit', String.raw`\b(?:true|false|null|~)\b`],
    ['num', String.raw`\b\d+(?:\.\d+)?\b`],
  ],
};
TOKEN_RULES.js = TOKEN_RULES.ts;
TOKEN_RULES.mjs = TOKEN_RULES.ts;
TOKEN_RULES.sh = TOKEN_RULES.bash;
TOKEN_RULES.yml = TOKEN_RULES.yaml;

const compiledRules = new Map();

function compiledLanguage(language) {
  let compiled = compiledRules.get(language);
  if (compiled === undefined) {
    const rules = TOKEN_RULES[language];
    compiled =
      rules === undefined
        ? null
        : {
            rules,
            expression: new RegExp(rules.map(([, source]) => `(${source})`).join('|'), 'gmu'),
          };
    compiledRules.set(language, compiled);
  }
  return compiled;
}

function highlightCode(source, language) {
  const compiled = compiledLanguage(language);
  if (compiled === null) return escapeHtml(source);
  const { rules, expression } = compiled;
  let html = '';
  let cursor = 0;
  for (const match of source.matchAll(expression)) {
    if (match.index === undefined) continue;
    if (match.index > cursor) html += escapeHtml(source.slice(cursor, match.index));
    const ruleIndex = rules.findIndex((_rule, index) => match[index + 1] !== undefined);
    const token = rules[ruleIndex]?.[0];
    html += token === undefined ? escapeHtml(match[0]) : `<span class="tk-${token}">${escapeHtml(match[0])}</span>`;
    cursor = match.index + match[0].length;
  }
  return html + escapeHtml(source.slice(cursor));
}

function languageFromPath(path) {
  const extension = path === undefined ? undefined : /\.([a-z]+)$/iu.exec(path)?.[1];
  return extension === undefined || TOKEN_RULES[extension] === undefined ? undefined : extension;
}

function codeFigure(label, language, escapedContent, attributes = '') {
  const highlighted = highlightCode(unescapeCode(escapedContent), language);
  const codeClass = language === undefined ? '' : ` class="language-${language}"`;
  return `<figure class="doc-code"${attributes}><figcaption class="doc-code-bar"><span class="doc-code-label">${label}</span><button class="doc-code-copy" type="button" disabled>Copy</button></figcaption><pre class="doc-code-scroll" tabindex="0"><code${codeClass}>${highlighted}</code></pre></figure>`;
}

export function canonicalizeDocsMarkup(markup) {
  const accessibleCode = markup.replaceAll(
    /<pre><code(?: class="([^"]+)")?>([\s\S]*?)<\/code><\/pre>/gu,
    (_match, className = '', content = '') => {
      const language = className.match(/^language-(.+)$/u)?.[1];
      const label = language ? `${LANGUAGE_NAMES[language] ?? language} example` : 'Code example';
      return codeFigure(label, language, content);
    },
  );
  return accessibleCode.replaceAll(/href="(\/docs\/[^"#?]*)([?#][^"]*)?"/gu, (_match, source, suffix = '') => {
    const canonical = canonicalDocsPath(source);
    if (canonical === undefined) throw new Error(`Documentation content links to an unmapped route: ${source}`);
    return `href="${canonical}${suffix}"`;
  });
}

export function enhanceDocCodeFigures(markup) {
  return markup.replaceAll(
    /<figure class="doc-code"([^>]*)><figcaption>([\s\S]*?)<\/figcaption><pre(?: tabindex="0")?><code(?: class="([^"]*)")?>([\s\S]*?)<\/code><\/pre><\/figure>/gu,
    (_match, attributes = '', label = '', className = '', content = '') => {
      const sourcePath = attributes.match(/data-source-path="([^"]+)"/u)?.[1];
      const language = className.match(/^language-(.+)$/u)?.[1] ?? languageFromPath(sourcePath);
      return codeFigure(label || 'Code example', language, content, attributes);
    },
  );
}

export function highlightDocCodePres(markup) {
  return markup.replaceAll(
    /<pre tabindex="0"><code((?: [a-z-]+="[^"]*")*)>([\s\S]*?)<\/code><\/pre>/gu,
    (_match, codeAttributes = '', content = '') => {
      const language = /language-([\w-]+)/u.exec(codeAttributes)?.[1] ?? 'ts';
      return `<pre tabindex="0"><code${codeAttributes}>${highlightCode(unescapeCode(content), language)}</code></pre>`;
    },
  );
}

const navLink = (id, label) =>
  Object.freeze({ type: 'link', path: routeById(id).path, ...(label === undefined ? {} : { label }) });
const navSubgroup = (label, ids) =>
  Object.freeze({ type: 'subgroup', label, items: Object.freeze(ids.map((id) => navLink(id))) });
const navGroup = (label, index, items) => Object.freeze({ label, index, items: Object.freeze(items) });

export const DOC_NAVIGATION = Object.freeze([
  navGroup('Get started', '/', [
    navLink('home', 'Overview'),
    navLink('what-is', 'What is Varendo?'),
    navLink('quickstart', 'Quickstart'),
    navLink('registered-app', 'Connect your data'),
    navLink('agents-quickstart', 'Add an agent'),
    navSubgroup('Integration paths', ['existing-app', 'frameworks', 'standalone']),
    navSubgroup('Examples', ['examples', 'people-example', 'products-example', 'support-example', 'knowledge-example']),
  ]),
  navGroup('Components', '/components/', [navLink('components'), Object.freeze({ type: 'component-families' })]),
  navGroup('Advanced', '/advanced/', [
    navLink('advanced', 'Overview'),
    navSubgroup('Composition & state', [
      'workspace',
      'adaptive-region',
      'responsive',
      'custom-views',
      'state-ownership',
      'forms',
      'navigation',
    ]),
    navSubgroup('Data & permissions', [
      'resources',
      'local-data',
      'http-data',
      'data',
      'permissions',
      'actions',
      'scopes',
      'analytics',
    ]),
    navSubgroup('Agents & protocols', ['agents', 'mcp', 'webmcp', 'byok', 'agent-recovery']),
    navSubgroup('Concepts', ['concepts', 'intent', 'semantics', 'safety']),
    navSubgroup('API reference', ['reference', 'packages', 'app-api', 'intent-schema', 'diagnostics', 'search']),
    navSubgroup('Production & releases', [
      'ship',
      'ssr',
      'browser-support',
      'support-matrix',
      'migration',
      'migration-0-4',
      'migration-0-5',
      'migration-varendo',
      'migration-0-6',
      'migration-varendo-0-2',
      'release-notes',
    ]),
    navSubgroup('Project & community', ['contribute', 'about', 'support', 'security', 'license', 'privacy']),
  ]),
]);

export const LEGACY_DOC_REDIRECTS = Object.freeze({
  '/connect/mcp/': '/agents/mcp/',
  '/connect/webmcp/': '/agents/webmcp/',
  ...Object.fromEntries(
    DOC_ROUTES.filter((item) => item.sourcePath !== undefined && item.sourcePath !== item.path).map((item) => [
      item.sourcePath,
      item.path,
    ]),
  ),
  '/0.1/': '/ship/migration-0.3/',
  '/ship/migration-0.1/': '/ship/migration-0.3/',
  '/docs/0.1/': '/ship/migration-0.3/',
  '/docs/ship/migration-0.1/': '/ship/migration-0.3/',
});
