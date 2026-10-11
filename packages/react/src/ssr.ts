/** Opt-in React SSR and client hydration setup. Import before React and Varendo bindings. */
import '@lit-labs/ssr-react/enable-lit-ssr.js';
import { registerAeliqoElements } from '@varendo/web/register';
registerAeliqoElements();
