import { registerAeliqoElements } from '@varendo/web/register';

registerAeliqoElements();

const status = document.querySelector<HTMLElement>('#island-status');
if (status !== null) status.textContent = 'Island hydrated.';
