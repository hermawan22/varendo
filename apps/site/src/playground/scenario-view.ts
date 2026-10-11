import { defineView } from '@varendo/web/recipes';
import { html } from 'lit';

export const knowledgeArticleView = defineView({
  ref: { id: 'demo.knowledge-article', revision: '1' },
  manifest: {
    ref: { id: 'demo.knowledge-article', revision: '1' },
    configSchema: { id: 'demo.knowledge-article.config', revision: '1' },
    roles: ['article'],
    operations: [{ id: 'data.read', revision: '1' }],
    result: 'required',
    children: { min: 0, max: 0 },
    visibility: 'leaf',
    extension: true,
    resolveConfig: (values) => ({
      ok: true,
      value: {
        values,
        fields: ['title', 'topic', 'excerpt', 'content'],
        ports: [],
        operations: [{ id: 'data.read', revision: '1' }],
      },
    }),
  },
  render: ({ result }) => {
    const article = result?.rows[0];
    if (article === undefined) return html`<p>No article was found.</p>`;
    return html`<article class="knowledge-article">
      <p>${String(article.topic)}</p>
      <h2>${String(article.title)}</h2>
      <p class="knowledge-summary">${String(article.excerpt)}</p>
      <p>${String(article.content)}</p>
    </article>`;
  },
});
