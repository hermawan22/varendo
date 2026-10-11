export * from './contracts/index.js';
export { defineResource, compileIntent } from './app/index.js';
export type {
  CompileIntentOptions,
  ResourceDefinition,
  ResourceFieldMetadata,
  ResourceFormBinding,
  ResourceInput,
  ResourceMeasure,
  ResourcePresentationDefaults,
  StandardIntentKind,
} from './app/types.js';
export {
  defineDataFeature,
  defineFeature,
  inferLocalDataShape,
  DATA_FEATURE_VIEW_ALIASES,
  FeatureDefinitionError,
} from './features/index.js';
export type {
  DataFeatureDefinition,
  DataFeatureInput,
  DataFeatureViewAlias,
  FeatureCapabilityDefinition,
  FeatureCapabilityKind,
  FeatureDefinition,
  FeatureIntentDefinition,
  FeatureIntentValue,
  FeatureViewDefinition,
  NonDataFeatureDefinition,
  NonDataFeatureInput,
} from './features/index.js';
export type { LocalDataFieldKind, LocalDataShape, LocalDataShapeField, LocalDataShapeInput } from './features/index.js';
