import type { PresentationManifest } from '@varendo/core/presentation';
import { createVarendoVisualizationPresentationManifests } from './visualization-registry.js';
import { createVarendoDataPresentationManifests } from './data-presentation.js';
import { createNavigationFeedbackPresentationManifests } from './navigation-feedback-registry.js';
import { createInputPresentationManifests } from './input-registry.js';
import { createFoundationPresentationManifests } from './foundation-registry.js';
import { buildManifests } from './registry-base.js';

const defaultFoundation = createFoundationPresentationManifests();
if (!defaultFoundation.ok) throw new Error('Default foundation manifests are invalid.');
const defaultInputs = createInputPresentationManifests();
if (!defaultInputs.ok) throw new Error('Default input manifests are invalid.');
const defaultNavigationFeedback = createNavigationFeedbackPresentationManifests();
if (!defaultNavigationFeedback.ok) throw new Error('Default navigation/feedback manifests are invalid.');
const defaultData = createVarendoDataPresentationManifests([]);
if (!defaultData.ok) throw new Error('Default data manifests are invalid.');
const defaultVisualizations = createVarendoVisualizationPresentationManifests([]);
if (!defaultVisualizations.ok) throw new Error('Default visualization manifests are invalid.');

export const VARENDO_PRESENTATION_MANIFESTS: readonly PresentationManifest[] = Object.freeze([
  ...buildManifests({}),
  ...defaultFoundation.value,
  ...defaultInputs.value,
  ...defaultNavigationFeedback.value,
  ...defaultData.value,
  ...defaultVisualizations.value,
]);
