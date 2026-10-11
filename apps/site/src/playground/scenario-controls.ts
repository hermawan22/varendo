import type { Intent } from '@varendo/core';
import { PLAYGROUND_SCENARIOS, type PlaygroundScenario } from './scenarios.js';

export function findScenario(id: string): PlaygroundScenario {
  return PLAYGROUND_SCENARIOS.find((candidate) => candidate.id === id) ?? PLAYGROUND_SCENARIOS[0]!;
}

export function renderScenarioControls(
  scenario: PlaygroundScenario,
  description: HTMLElement,
  stepsHost: HTMLElement,
  runIntent: (intent: Intent, trigger?: HTMLButtonElement) => Promise<void>,
): void {
  description.textContent = scenario.description;
  stepsHost.replaceChildren();
  for (const step of scenario.steps) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.step = step.id;
    const strong = document.createElement('strong');
    strong.textContent = step.label;
    const detail = document.createElement('span');
    detail.textContent = step.description;
    button.append(strong, detail);
    button.addEventListener('click', () => void runIntent(step.intent(), button));
    stepsHost.append(button);
  }
}

export function labelIntent(scenario: PlaygroundScenario, intent: Intent): string {
  if (intent.resource === 'daily-attendance') return 'Daily attendance';
  if (intent.kind === 'custom' && intent.resource === 'attendance')
    return intent.intent.id === 'attendance.page' ? 'Registered page' : 'Analytical workspace';
  if (intent.id === 'people-jakarta') return 'People in Jakarta';
  const registered = scenario.steps.find((step) => step.id === intent.id);
  if (registered !== undefined) return registered.label;
  const kind = intent.kind.replace(/^\w/u, (letter) => letter.toUpperCase());
  return `${kind} ${scenario.label.toLowerCase()}`;
}
