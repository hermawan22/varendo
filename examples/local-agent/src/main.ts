import { registerAeliqoElements } from '@varendo/web/register';
registerAeliqoElements();
import './style.css';
import { createLocalSession } from './session.js';
import { connectLocalHost, type LocalHostConnection } from './local-host.js';

function element<T extends HTMLElement>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (value === null) throw new Error(`Missing ${selector}`);
  return value;
}
const status = element('#status');
const receipt = element('#receipt');
const modelStatus = element('#model-status');
const prompt = element<HTMLTextAreaElement>('#prompt');
const send = element<HTMLButtonElement>('#send');
const disconnect = element<HTMLButtonElement>('#disconnect');
const reconnect = element<HTMLButtonElement>('#reconnect');
let session: ReturnType<typeof createLocalSession> | undefined;
let connection: LocalHostConnection | undefined;
let expiry: ReturnType<typeof setTimeout> | undefined;
let promptController: AbortController | undefined;

function stop(message = 'Disconnected. Start a new session to reconnect your MCP client.') {
  clearTimeout(expiry);
  promptController?.abort();
  connection?.close();
  session?.dispose();
  connection = undefined;
  session = undefined;
  disconnect.disabled = true;
  prompt.disabled = true;
  send.disabled = true;
  reconnect.hidden = false;
  status.textContent = message;
}

async function start() {
  const response = await fetch('/api/aeliqo/session', {
    headers: { accept: 'application/json', 'x-aeliqo-session-bootstrap': '1' },
  });
  if (!response.ok) throw new Error(`Session unavailable (${response.status}).`);
  const settings = (await response.json()) as { expiresAt: number; modelConfigured: boolean };
  session = createLocalSession(element('#region'), settings.expiresAt);
  const rendered = await session.render();
  if (rendered.status !== 'renderer-ready')
    throw new Error(rendered.diagnostics[0]?.message ?? 'The initial render failed.');
  connection = await connectLocalHost(session, () =>
    stop('The local host disconnected. Start a new session after restarting it.'),
  );
  status.textContent = 'Connected — MCP is ready. This session expires after 15 minutes.';
  modelStatus.textContent = settings.modelConfigured
    ? 'A server model is configured. Sending a prompt may incur provider charges; registered metadata and tool results may leave this machine.'
    : 'No model configured. MCP works now; configure .env.local and restart to enable prompts.';
  prompt.disabled = !settings.modelConfigured;
  send.disabled = !settings.modelConfigured;
  disconnect.disabled = false;
  reconnect.hidden = true;
  expiry = setTimeout(
    () => stop('Session expired. Start a new session to continue.'),
    Math.max(0, settings.expiresAt - Date.now()),
  );
}

async function sendPrompt(event: SubmitEvent) {
  event.preventDefault();
  if (prompt.disabled || prompt.value.trim() === '' || promptController !== undefined) return;
  const controller = new AbortController();
  promptController = controller;
  send.disabled = true;
  receipt.textContent = 'Agent working…';
  try {
    const response = await fetch('/api/aeliqo/prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: prompt.value.trim() }),
      signal: controller.signal,
    });
    const result = (await response.json()) as { stop?: string; message?: string; error?: string };
    if (!response.ok) throw new Error(result.message ?? result.error ?? 'The model request failed.');
    receipt.textContent = `${result.stop ?? 'finished'}${result.message ? `: ${result.message}` : ''}`;
  } catch (error) {
    receipt.textContent = controller.signal.aborted ? 'Prompt cancelled.' : String(error);
  } finally {
    if (promptController === controller) promptController = undefined;
    send.disabled = prompt.disabled;
  }
}

function begin() {
  void start().catch((error: unknown) => stop(String(error)));
}
element<HTMLFormElement>('#prompt-form').addEventListener('submit', (event) => {
  void sendPrompt(event);
});
disconnect.addEventListener('click', () => stop());
reconnect.addEventListener('click', begin);
window.addEventListener('pagehide', () => stop());
begin();
