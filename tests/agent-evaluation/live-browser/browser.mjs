import { registerAeliqoElements } from '@varendo/web/register';
import { openJ1, openJ2 } from './j1-j2.mjs';
import { openJ3 } from './j3.mjs';

registerAeliqoElements();
const target = document.querySelector('#journey-region');
let current;

window.liveHost = Object.freeze({
  async open(journey) {
    current?.close();
    current = undefined;
    target.replaceChildren();
    document.documentElement.lang = 'en';
    target.removeAttribute('data-needs');
    target.removeAttribute('data-presentation');
    if (journey === 'J1') current = await openJ1(target);
    else if (journey === 'J2') current = await openJ2(target);
    else if (journey === 'J3') current = await openJ3(target);
    else throw new Error('Unknown registered journey.');
    return true;
  },
  discover() {
    if (current === undefined) throw new Error('No active journey.');
    return current.endpoint.discover();
  },
  authorizeModel() {
    if (current === undefined) throw new Error('No active journey.');
    return current.endpoint.authorizeModel();
  },
  invoke(name, input, requestId) {
    if (current === undefined) throw new Error('No active journey.');
    return current.endpoint.invoke(name, input, { requestId });
  },
  snapshot() {
    if (current === undefined) throw new Error('No active journey.');
    const text = [];
    const visit = (node) => {
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) text.push(node.textContent.trim());
      if (node.shadowRoot) visit(node.shadowRoot);
      for (const child of node.childNodes) visit(child);
    };
    visit(target);
    const count = (selector) => {
      let total = 0;
      const scan = (node) => {
        if (node instanceof Element && node.matches(selector)) total++;
        if (node.shadowRoot) scan(node.shadowRoot);
        for (const child of node.childNodes) scan(child);
      };
      scan(target);
      return total;
    };
    const chartRows = [];
    const collectCharts = (node) => {
      if (node instanceof Element && node.localName === 'aeliqo-chart') {
        chartRows.push(
          [...(node.shadowRoot?.querySelectorAll('tbody tr') ?? [])].map((row) =>
            [...row.children].map((cell) => cell.textContent?.trim() ?? ''),
          ),
        );
      }
      if (node.shadowRoot) collectCharts(node.shadowRoot);
      for (const child of node.childNodes) collectCharts(child);
    };
    collectCharts(target);
    return {
      text: text.join(' '),
      needs: target.dataset.needs ?? null,
      presentation: target.dataset.presentation ?? null,
      tableCount: count('aeliqo-table'),
      chartCount: count('aeliqo-chart'),
      chartRows,
    };
  },
  close() {
    current?.close();
    current = undefined;
  },
});
