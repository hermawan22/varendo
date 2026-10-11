export { AdaptiveSurface, ViewSurface } from './render.js';
export { useDataSurface, useSurface } from './controller.js';
export { useSurfaceState } from './hooks.js';
export { AeliqoScope, useAeliqoScope, useAeliqoScopeState } from './scope.js';
export { defineReactViews } from './views.js';
export type { AdaptiveSurfaceProps, LocalAdaptiveSurfaceProps, ViewSurfaceProps } from './render.js';
export type { AeliqoScopeProps } from './scope.js';
export type {
  ScopedCapabilitySurfaceOptions,
  ScopedDataSurfaceOptions,
  SurfaceControllerFactory,
  UseDataSurfaceOptions,
  UseSurfaceOptions,
} from './controller.js';
export type { LocalDataSurface, LocalDataSurfaceOptions } from './local.js';
export type { ReactViewDefinition, ReactViewInput, ReactViewProps, ReactViewRegistry } from './types.js';
