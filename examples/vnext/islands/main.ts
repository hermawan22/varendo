import { registerVarendoElements } from '@varendo/web/register';

registerVarendoElements();

const status = document.querySelector<HTMLElement>('#island-status');
if (status !== null) status.textContent = 'Island hydrated.';
