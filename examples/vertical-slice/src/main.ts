import { registerVarendoElements } from '@varendo/web';
import type { VarendoRegionElement } from '@varendo/web/region';
import { varendoStandaloneThemeStyles } from '@varendo/web/styles';
import { createHrViewSession, type HrViewSession } from './view-session.js';

declare global {
  interface Window {
    hrFixture?: HrViewSession;
  }
}
const style = document.createElement('style');
style.textContent = varendoStandaloneThemeStyles.cssText;
document.head.append(style);
registerVarendoElements();
const view = document.querySelector<VarendoRegionElement>('#hr-region')!;
const status = document.querySelector<HTMLElement>('#status')!;
const reorder = document.querySelector<HTMLButtonElement>('#reorder')!;
document.querySelector<HTMLSelectElement>('#theme')!.addEventListener('change', (event) => {
  document.querySelector('main')!.dataset.varendoTheme = (event.currentTarget as HTMLSelectElement).value;
});

try {
  const session = await createHrViewSession();
  window.hrFixture = session;
  const render = () => {
    view.presentation = session.presentation;
    view.results = session.results;
    view.interaction = session.interaction;
  };
  const unsubscribe = session.subscribe(render);
  render();
  status.textContent = 'Five employees · Weekly rates use the same ranked population.';
  reorder.disabled = false;
  view.onSemanticInteraction = async (request) => {
    const receipt = await session.dispatch(request);
    if (!receipt.ok) {
      status.textContent = receipt.diagnostics[0]?.message ?? 'The selection could not be applied.';
      return;
    }
    if (request.payload.kind === 'selection')
      status.textContent =
        request.payload.selection.mode === 'ids'
          ? `Selected employee ${request.payload.selection.keys.map((key) => session.selectionLabel(key) ?? 'Unknown employee').join(', ')}.`
          : 'Selection cleared.';
  };
  reorder.addEventListener('click', async () => {
    reorder.disabled = true;
    try {
      await session.reorder();
      status.textContent = 'View order changed. The same results and selection are preserved.';
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'The view change could not be applied.';
    } finally {
      reorder.disabled = false;
    }
  });
  window.addEventListener(
    'pagehide',
    () => {
      unsubscribe();
      session.dispose();
      view.dispose();
    },
    { once: true },
  );
} catch (error) {
  status.textContent = error instanceof Error ? error.message : 'The sample could not be loaded.';
}
