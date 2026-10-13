import { registerVarendoElements } from '@varendo/web/register';
import type { VarendoRegionElement } from '@varendo/web/region';
import { createUiDevelopmentHost, task, type UiDevelopmentHost } from './host.js';

registerVarendoElements();

const region = document.querySelector<VarendoRegionElement>('#region');
if (region === null) throw new Error('The development region element is missing.');

const host = createUiDevelopmentHost('manual');
host.attach(region);
let heldProposalId: string | undefined;
let heldCommit: ReturnType<UiDevelopmentHost['commit']> | undefined;

const waitForUpdate = async (): Promise<void> => {
  await region.updateComplete;
};

const evaluateUiTask = async (): Promise<{ readonly state: 'data-ready' }> => {
  const evaluated = await host.evaluateTask(task);
  if (!evaluated.ok || evaluated.value.state !== 'data-ready')
    throw new Error('The development task did not produce an authorized result.');
  await waitForUpdate();
  return { state: evaluated.value.state };
};

const proposeUiTask = async (): Promise<{
  readonly state: 'bound';
  readonly proposalId: string;
  readonly regionRevision: string;
  readonly materializationVersion: number;
}> => {
  const plan = host.plan();
  if (!plan.ok) throw new Error(plan.diagnostics[0]?.message ?? 'The development plan could not be created.');
  const proposed = await host.propose(plan.value);
  if (
    !proposed.ok ||
    proposed.value.state !== 'bound' ||
    proposed.value.value === undefined ||
    typeof proposed.value.value !== 'object' ||
    Array.isArray(proposed.value.value)
  )
    throw new Error('The development proposal was not bound.');
  const proposal = proposed.value.value as {
    readonly proposalId?: unknown;
    readonly regionRevision?: unknown;
    readonly materializationVersion?: unknown;
  };
  if (
    typeof proposal.proposalId !== 'string' ||
    typeof proposal.regionRevision !== 'string' ||
    typeof proposal.materializationVersion !== 'number'
  )
    throw new Error('The development proposal did not return a complete bounded receipt.');
  return {
    state: proposed.value.state,
    proposalId: proposal.proposalId,
    regionRevision: proposal.regionRevision,
    materializationVersion: proposal.materializationVersion,
  };
};

const commitUiProposal = async (
  proposalId: string,
): Promise<{ readonly state: string; readonly diagnostics: readonly string[] }> => {
  const committed = await host.commit(proposalId);
  if (!committed.ok)
    throw new Error(committed.diagnostics[0]?.message ?? 'The development proposal could not be committed.');
  await waitForUpdate();
  return { state: committed.value.state, diagnostics: committed.value.diagnostics.map((item) => item.message) };
};

const complete = async (): Promise<{ readonly proposalId: string }> => {
  await evaluateUiTask();
  const proposed = await proposeUiTask();
  const committed = await commitUiProposal(proposed.proposalId);
  if (committed.state !== 'renderer-ready') throw new Error('The development presentation did not commit.');
  return { proposalId: proposed.proposalId };
};

const recommit = async (): Promise<void> => {
  const proposed = await proposeUiTask();
  const committed = await commitUiProposal(proposed.proposalId);
  if (committed.state !== 'renderer-ready') throw new Error('The rebound presentation did not commit.');
};

const prepareUiProposal = async (): Promise<void> => {
  heldProposalId = (await proposeUiTask()).proposalId;
};

const commitHeldUiProposal = async (): Promise<{ readonly state: string }> => {
  if (heldProposalId === undefined) throw new Error('No held proposal is available.');
  return commitUiProposal(heldProposalId);
};

const malformedUiProposal = async (): Promise<{ readonly state: string }> => {
  const malformed = await host.propose({ version: '1', id: 'malformed-ui-proposal', revision: '1' });
  if (!malformed.ok)
    throw new Error(malformed.diagnostics[0]?.message ?? 'The malformed proposal could not be inspected.');
  return { state: malformed.value.state };
};

const startHeldUiCommit = (): void => {
  if (heldProposalId === undefined) throw new Error('No held proposal is available.');
  host.holdNextCommit();
  heldCommit = host.commit(heldProposalId);
};

const waitForUiCommitAuthorization = (): Promise<void> => host.waitForCommitAuthorization();

const settleHeldUiCommit = async (): Promise<{ readonly state: string }> => {
  if (heldCommit === undefined) throw new Error('No held commit is running.');
  const committed = await heldCommit;
  heldCommit = undefined;
  await waitForUpdate();
  if (!committed.ok) throw new Error(committed.diagnostics[0]?.message ?? 'The held proposal could not be inspected.');
  return { state: committed.value.state };
};

Object.assign(window, {
  varendoUiReady: true,
  evaluateUiTask,
  proposeUiTask,
  commitUiProposal,
  completeUiTask: complete,
  recommitUiTask: recommit,
  prepareUiProposal,
  commitHeldUiProposal,
  malformedUiProposal,
  startHeldUiCommit,
  waitForUiCommitAuthorization,
  settleHeldUiCommit,
  revokeUiTask: (reason?: string) => host.revoke(reason),
  uiSnapshot: () => host.region.snapshot(),
  uiDependencies: () => host.dependencies(),
  disposeUiTask: () => host.dispose(),
});
