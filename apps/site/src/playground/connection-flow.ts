import type { PlaygroundSession } from './session.js';

type DotState = 'connected' | 'connecting' | 'disconnected' | 'unavailable';
export interface ConnectionElements {
  status: HTMLElement;
  label: HTMLElement;
  dot: HTMLElement;
  connectButton: HTMLButtonElement;
  webmcpNote: HTMLElement;
}

/** The public page exposes browser tools. Model execution belongs to the browser agent. */
export function createConnectionFlow(elements: ConnectionElements, session: () => PlaygroundSession) {
  let connected = false;
  let generation = 0;
  const show = (message: string, state: DotState) => {
    elements.status.textContent = message;
    elements.label.textContent = message;
    elements.dot.dataset.state = state;
  };
  const reset = () => {
    generation++;
    connected = false;
    session().disconnectWebMcp();
    elements.connectButton.disabled = false;
    elements.connectButton.textContent = 'Enable WebMCP';
    show('Manual controls ready · no agent connected.', 'disconnected');
  };
  return {
    async prepare(): Promise<void> {
      const { detectWebMcp } = await import('@varendo/agent/webmcp');
      const supported = detectWebMcp({ document, evidence: 'native' }).supported;
      elements.webmcpNote.hidden = supported;
      if (!connected)
        show(
          supported
            ? 'Browser API available. Tools are not registered yet.'
            : 'Browser tools unavailable. Manual controls still work.',
          supported ? 'disconnected' : 'unavailable',
        );
    },
    async connect(): Promise<void> {
      if (connected) {
        reset();
        return;
      }
      const operation = ++generation;
      elements.connectButton.disabled = true;
      show('Registering browser tools…', 'connecting');
      try {
        const result = await session().connectWebMcp((state) => {
          if (operation !== generation) return;
          const messages = {
            invoking: 'Browser agent is calling a tool…',
            ready: 'Tools registered. Ask your browser agent to inspect this page.',
            applied: 'Agent result applied to the live interface.',
            failed: 'The tool did not apply a new result. Inspect its receipt for details.',
          };
          show(messages[state], state === 'invoking' ? 'connecting' : 'connected');
        });
        if (operation !== generation) return;
        connected = result.ok;
        if (result.ok) {
          show(`WebMCP registered ${result.value.registrations} tools (experimental).`, 'connected');
          elements.connectButton.textContent = 'Disconnect WebMCP';
        } else show(result.diagnostics[0]?.message ?? 'Tool registration failed.', 'unavailable');
      } catch {
        if (operation === generation) show('WebMCP could not start. Reload and try again.', 'unavailable');
      } finally {
        if (operation === generation) elements.connectButton.disabled = false;
      }
    },
    disconnect: reset,
    close: reset,
    reset,
    show,
  };
}
