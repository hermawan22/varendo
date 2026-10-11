import { marked } from 'marked';
import { routeById } from '../../docs/public-site/routes.mjs';
import { documentedEvents, listenerExample, propertyDescription } from './component-doc-copy.mjs';
import { escape, hasExactKeys } from './docs-lib.mjs';

const escapeMarkdown = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '\\|')
    .replaceAll('`', '\\`');

export const COMPONENT_HEADINGS = [
  'Purpose',
  'When to use it',
  'When to use a different component',
  'Import and live example',
  'Properties and defaults',
  'Events',
  'States and failure handling',
  'Keyboard, focus, and accessibility',
  'Responsive behavior',
  'Style hooks',
  'Related components',
  'Version',
  'Generated TypeScript declaration',
];

export const COMPONENT_DIRECTIVES = [
  'fixture',
  'example',
  'properties',
  'events',
  'states',
  'outcome',
  'keyboard',
  'semantics',
  'style-hooks',
  'performance',
  'declaration',
];

function splitFrontmatter(source, message) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/u);
  if (!match || match[1] === undefined || match[2] === undefined) throw new Error(message);
  return { frontmatter: match[1], body: match[2] };
}

function frontmatterScalar(field, scalar, { label, quoted }) {
  if (scalar.startsWith("'") && scalar.endsWith("'")) return scalar.slice(1, -1).replaceAll("''", "'");
  if (!quoted && !scalar.startsWith('"')) return scalar;
  try {
    return JSON.parse(scalar);
  } catch {
    throw new Error(
      quoted
        ? `Public page metadata must use quoted string values in ${label}`
        : `Malformed quoted frontmatter string in ${label}: ${field}`,
    );
  }
}

function parseFrontmatter(frontmatter, { label, scalars }) {
  const context = { label, quoted: scalars === 'quoted' };
  const values = Object.create(null);
  for (const line of frontmatter.split(/\r?\n/u)) {
    const field = line.match(/^([a-z]+): (.+)$/u);
    if (!field || field[1] === undefined || field[2] === undefined || Object.hasOwn(values, field[1]))
      throw new Error(
        `Malformed ${context.quoted ? 'public page' : 'component documentation'} frontmatter in ${label}`,
      );
    values[field[1]] = frontmatterScalar(field[1], field[2], context);
  }
  return values;
}

function assertComponentMetadata(values, component) {
  const expected = ['component', 'contract', 'family', 'title'];
  if (!hasExactKeys(values, expected))
    throw new Error(`Unexpected component documentation metadata in ${component.id}`);
  if (
    values.component !== component.id ||
    values.title !== component.name ||
    values.family !== component.family ||
    values.contract !== component.contract
  )
    throw new Error(`Component documentation metadata is out of sync with the catalog: ${component.id}`);
}

function assertComponentHeadings(body, componentId) {
  const headings = [...body.matchAll(/^## (.+)$/gmu)].map((heading) => heading[1]);
  for (const heading of COMPONENT_HEADINGS) {
    if (!headings.includes(heading)) throw new Error(`Missing "${heading}" in ${componentId} documentation`);
  }
  if (new Set(headings).size !== headings.length)
    throw new Error(`Duplicate component documentation section in ${componentId}`);
}

function assertComponentDirectives(body, componentId) {
  if (/\b(?:TODO|TBD|placeholder|not declared)\b/iu.test(body))
    throw new Error(`Remove placeholder text from ${componentId} documentation`);
  for (const token of COMPONENT_DIRECTIVES) {
    if (!body.includes(`{{aeliqo:${token}}}`))
      throw new Error(`Missing generated ${token} directive in ${componentId} documentation`);
  }
  if (body.match(/\{\{aeliqo:example\}\}/gu)?.length !== 1)
    throw new Error(`Component documentation must contain one live example: ${componentId}`);
}

export function parseComponentDocument(source, component) {
  const frontmatter = splitFrontmatter(source, `Component documentation needs YAML frontmatter: ${component.id}`);
  const metadata = parseFrontmatter(frontmatter.frontmatter, { label: component.id, scalars: 'verbatim' });
  assertComponentMetadata(metadata, component);
  assertComponentHeadings(frontmatter.body, component.id);
  assertComponentDirectives(frontmatter.body, component.id);
  return frontmatter.body;
}

function assertPageMetadata(metadata, filePath) {
  const required = ['description', 'id', 'path', 'section', 'title'];
  if (!hasExactKeys(metadata, required)) throw new Error(`Unexpected public page metadata fields in ${filePath}`);
  for (const key of required) {
    if (typeof metadata[key] !== 'string' || metadata[key] === '')
      throw new Error(`Public page metadata ${key} must be a non-empty string in ${filePath}`);
  }
  const route = routeById(metadata.id);
  if (metadata.path !== route.path || metadata.section !== route.group)
    throw new Error(`Public page route metadata is out of sync with the route manifest: ${metadata.id}`);
}

export function parseAuthoredPage(source, filePath) {
  const page = splitFrontmatter(source, `Public page needs YAML frontmatter: ${filePath}`);
  const metadata = parseFrontmatter(page.frontmatter, { label: filePath, scalars: 'quoted' });
  assertPageMetadata(metadata, filePath);
  const body = String(marked.parse(page.body, { gfm: true, async: false })).trim();
  if (!body) throw new Error(`Public page has no content: ${filePath}`);
  return { ...metadata, body };
}

function exampleMarkup(metadata) {
  return `<section class="component-adoption" data-component-preview="${escape(metadata.family)}.${escape(metadata.id)}"><div class="component-preview" data-preview-mount data-preview-family="${escape(metadata.family)}" data-preview-id="${escape(metadata.id)}"><p class="component-preview-status" data-preview-status>Interactive preview requires JavaScript.</p></div><details class="component-example"><summary>View the complete example source</summary><pre tabindex="0"><code data-example-code="${escape(metadata.id)}">${escape(metadata.source)}</code></pre><button type="button" data-copy-example="${escape(metadata.id)}" disabled>Copy example</button><p class="component-copy-status" data-copy-status role="status"></p></details></section>`;
}

function markdownList(values, emptyMessage) {
  if (values.length === 0) return `- ${escapeMarkdown(emptyMessage)}`;
  return values.map((value) => `- ${escapeMarkdown(value)}`).join('\n');
}

function propertiesTable(properties) {
  const rows = properties.map(({ name, type, default: initial }) => {
    const property = { name, type, default: initial };
    return `<tr><th scope="row"><code>${escape(name)}</code></th><td>${escape(propertyDescription(property))}</td><td><code>${escape(type)}</code></td><td><code>${escape(initial)}</code></td></tr>`;
  });
  return `<div class="api-table" role="region" aria-label="${properties.length} component properties" tabindex="0"><table><caption>Properties, ownership, and initial values</caption><thead><tr><th scope="col">Property</th><th scope="col">Use and ownership</th><th scope="col">Declared type</th><th scope="col">Initial value</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function inlineMarkup(value) {
  return escape(value).replaceAll(/`([^`]+)`/gu, '<code>$1</code>');
}

function eventsDocumentation(component, values) {
  const events = documentedEvents(values);
  if (events.length === 0) return markdownList(values, 'This component does not emit a component event.');
  const rows = events.map(
    ({ name, copy }) =>
      `<tr><th scope="row"><code>${escape(name)}</code></th>${copy.map((value) => `<td>${inlineMarkup(value)}</td>`).join('')}</tr>`,
  );
  const table = `<div class="doc-table" role="region" aria-label="${escape(component.name)} component events" tabindex="0"><table><caption>Events, payloads, timing, and application responsibilities</caption><thead><tr><th scope="col">Event</th><th scope="col">Payload</th><th scope="col">Emitted</th><th scope="col">Application responsibility</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  const listeners = events
    .map(
      (event) =>
        `<h3>Listen for <code>${escape(event.name)}</code></h3><figure class="doc-code"><figcaption>TypeScript example</figcaption><pre tabindex="0"><code class="language-ts">${escape(listenerExample(component, event))}</code></pre></figure>`,
    )
    .join('');
  return `${table}<p>Events cross the component boundary as user proposals. Validate their detail and current authority before applying a business effect.</p>${listeners}`;
}

function componentDocumentationBody(component, example, metadata, api, source) {
  const replacements = new Map();
  const componentMarkdown = source
    .replace('{{aeliqo:fixture}}', escapeMarkdown(example.fixture))
    .replace(
      '{{aeliqo:properties}}',
      `${escapeMarkdown(example.propsNotes)}\n\n${propertiesTable(metadata.properties)}`,
    )
    .replace('{{aeliqo:events}}', eventsDocumentation(component, example.events))
    .replace('{{aeliqo:states}}', markdownList(example.states, 'No non-default state is shown in this fixture.'))
    .replace('{{aeliqo:outcome}}', `Expected result: ${escapeMarkdown(example.expectedOutcome)}`)
    .replace(
      '{{aeliqo:keyboard}}',
      markdownList(example.keyboard, 'The component does not add a keyboard interaction.'),
    )
    .replace(
      '{{aeliqo:semantics}}',
      markdownList(
        metadata.semantics,
        'The component class does not set a native role or ARIA attribute; inspect its rendered children and host labels.',
      ),
    )
    .replace(
      '{{aeliqo:style-hooks}}',
      [
        `- Shadow parts: ${metadata.parts.length ? metadata.parts.map((part) => `\`${escapeMarkdown(part)}\``).join(', ') : 'none exposed by this class lineage.'}`,
        `- Varendo design tokens referenced: ${metadata.tokens.length ? metadata.tokens.map((token) => `\`${escapeMarkdown(token)}\``).join(', ') : 'none referenced directly by this class lineage.'}`,
      ].join('\n'),
    );
  const performance = metadata.bounds.length ? `## Performance limits\n\n${markdownList(metadata.bounds, '')}\n\n` : '';
  const withPerformance = componentMarkdown.replace('{{aeliqo:performance}}', performance);
  const liveExampleToken = `AELIQO_LIVE_EXAMPLE_${component.id}_CONTENT`;
  const declarationToken = `AELIQO_TYPESCRIPT_DECLARATION_${component.id}_CONTENT`;
  const expanded = withPerformance
    .replace('{{aeliqo:example}}', liveExampleToken)
    .replace('{{aeliqo:declaration}}', declarationToken);
  if (/\{\{aeliqo:/u.test(expanded)) throw new Error(`Unresolved documentation directive in ${component.id}`);
  const rendered = String(marked.parse(expanded, { gfm: true, async: false }));
  const declaration = `<details class="component-declaration"><summary>View generated declaration</summary><div class="code-scroll" role="region" aria-label="${escape(component.name)} TypeScript declaration"><pre tabindex="0"><code>${escape(api)}</code></pre></div></details>`;
  replacements.set(`<p>${liveExampleToken}</p>`, exampleMarkup(example));
  replacements.set(`<p>${declarationToken}</p>`, declaration);
  let html = rendered;
  for (const [marker, replacement] of replacements) {
    if (!html.includes(marker)) throw new Error(`Could not place generated content in ${component.id}`);
    html = html.replace(marker, replacement);
  }
  return html;
}

const MATURITY_LEVELS = [
  {
    name: 'Standalone',
    available: {
      state: 'available',
      label: 'Available',
      copy: 'Use the web element directly without the semantic runtime.',
    },
    unavailable: null,
  },
  {
    name: 'Semantic binding',
    surface: 'semantic',
    available: {
      state: 'available',
      label: 'Available',
      copy: 'A registered presentation adapter can bind this component to host-owned meaning and state.',
    },
    unavailable: {
      state: 'unavailable',
      label: 'No built-in binding',
      copy: 'Use this component directly or compose it in application code.',
    },
  },
  {
    name: 'Automatic adaptation',
    surface: 'adaptive',
    available: {
      state: 'standard',
      label: 'Standard recipe',
      copy: 'A standard recipe can select this component when its task, bindings, data, and policy are eligible.',
    },
    unavailable: {
      state: 'unavailable',
      label: 'No standard recipe',
      copy: 'The standard recipe resolver does not select this component automatically.',
    },
  },
];

function maturityCell(level, component) {
  const supported = level.surface === undefined || component.surfaces.includes(level.surface);
  const variant = supported ? level.available : (level.unavailable ?? level.available);
  return `<div><strong>${escape(level.name)}</strong><span data-state="${escape(variant.state)}">${escape(variant.label)}</span><p>${escape(variant.copy)}</p></div>`;
}

function maturityMarkup(component) {
  const cells = MATURITY_LEVELS.map((level) => maturityCell(level, component)).join('');
  return `<section class="component-maturity" aria-label="Integration levels">${cells}</section>`;
}

export function componentPage(component, example, metadata, api, source) {
  const body = componentDocumentationBody(component, example, metadata, api, source);
  const maturity = maturityMarkup(component);
  return {
    id: component.id,
    path: `/components/${component.id}/`,
    title: component.name,
    section: `Components / ${component.family}`,
    description: component.contract,
    component: component.id,
    body: `<div class="component-meta"><span><small>Family</small>${escape(component.family)}</span><span><small>License</small>${escape(component.license)}</span></div>${maturity}${body}`,
  };
}
