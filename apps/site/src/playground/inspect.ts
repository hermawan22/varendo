import type { Intent } from '@varendo/core';
import type { WebRenderReceipt } from '@varendo/web/app';

export type InspectorSection = 'intent' | 'task' | 'result' | 'presentation' | 'diagnostics';

export interface PlaygroundEvidence {
  readonly intent?: Intent;
  readonly receipt?: WebRenderReceipt;
}

export function selectedView(receipt: WebRenderReceipt): string {
  if (!('presentation' in receipt)) return receipt.status;
  return (
    receipt.presentation.nodes.find((node) => node.node.id === receipt.presentation.plan.rootId)?.manifest.id ??
    receipt.status
  );
}

export function viewLabel(view: string): string {
  const name = view.split('.').at(-1) ?? view;
  return name.replaceAll('-', ' ').replace(/^\w/u, (letter) => letter.toUpperCase());
}

const intentSummary = 'The exact bounded request sent by the task list or an agent tool.';
const diagnosticSummary = 'Actionable runtime diagnostics. Empty means no diagnostic was emitted for the last request.';

function taskEvidence(receipt: NonNullable<PlaygroundEvidence['receipt']>) {
  let task: unknown;
  if ('runtime' in receipt) task = receipt.runtime.task;
  else if ('task' in receipt) task = receipt.task;
  return { summary: 'The compiler output after resource, field, operation, and view validation.', value: task ?? {} };
}

function resultEvidence(receipt: NonNullable<PlaygroundEvidence['receipt']>) {
  const outputs = 'runtime' in receipt ? receipt.runtime.outputs : [];
  return {
    summary: 'Result descriptors and evidence only. Private records are intentionally omitted from the inspector.',
    value: outputs.map((output) => {
      const snapshot = output.handle.snapshot();
      return snapshot.descriptor ?? { status: snapshot.status };
    }),
  };
}

function presentationEvidence(receipt: NonNullable<PlaygroundEvidence['receipt']>) {
  if (!('presentation' in receipt))
    return { summary: 'No presentation committed for the last request.', value: { status: receipt.status } };
  const root = receipt.presentation.nodes.find((node) => node.node.id === receipt.presentation.plan.rootId);
  return {
    summary:
      'The selected registered view, environment, and validated plan. This is policy evidence, not model reasoning.',
    value: { selectedView: root?.manifest.id, environment: receipt.environment, plan: receipt.presentation.plan },
  };
}

interface EvidenceSection {
  readonly summary: string;
  readonly value: unknown;
}

const EVIDENCE_SECTIONS: Readonly<Record<InspectorSection, (evidence: PlaygroundEvidence) => EvidenceSection>> = {
  intent: (evidence) => ({ summary: intentSummary, value: evidence.intent ?? {} }),
  diagnostics: (evidence) => ({ summary: diagnosticSummary, value: evidence.receipt?.diagnostics ?? [] }),
  task: (evidence) =>
    evidence.receipt === undefined
      ? { summary: 'Run a request to inspect this stage.', value: {} }
      : taskEvidence(evidence.receipt),
  result: (evidence) =>
    evidence.receipt === undefined
      ? { summary: 'Run a request to inspect this stage.', value: {} }
      : resultEvidence(evidence.receipt),
  presentation: (evidence) =>
    evidence.receipt === undefined
      ? { summary: 'Run a request to inspect this stage.', value: {} }
      : presentationEvidence(evidence.receipt),
};

export function evidenceFor(evidence: PlaygroundEvidence, section: InspectorSection): EvidenceSection {
  return EVIDENCE_SECTIONS[section](evidence);
}
