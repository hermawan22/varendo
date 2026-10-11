export { createAgentMeaningAuthoring } from './authoring.js';
export {
  createMeaningActivationCapability,
  createMeaningProposalCapability,
  parseMeaningActivationInput,
  parseMeaningProposalInput,
} from './capabilities.js';
export type {
  AgentMeaningAuthoring,
  AgentMeaningAuthoringOptions,
  MeaningActivationCapabilityOptions,
  MeaningProposalCapabilityOptions,
  MeaningProposalInput,
  MeaningProposalPolicy,
} from './types.js';
export type { MeaningDraftJson, MeaningActivationJson } from './capabilities.js';
