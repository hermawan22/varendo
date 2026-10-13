import type { VarendoDataHostRequest } from './data-renderer.js';
import type { InteractionPayload, ResultRef, VersionRef } from '@varendo/core';
import type { VisualizationBindingContext } from '@varendo/core/visualization';
import type { PresentationManifest, ValidatedPresentation } from '@varendo/core/presentation';
import type { TemplateResult } from 'lit';
import type { nothing } from 'lit';
import type { VarendoTableColumn, VarendoTableRow } from '../types.js';
import type { VarendoDataScope } from '../data/types.js';

/** Rows already resolved by the application for one exact authorized ResultRef. */
export interface VarendoRegionResult {
  readonly ref: ResultRef;
  readonly rows: readonly VarendoTableRow[];
  readonly columns?: readonly VarendoTableColumn[];
  /** Current host-owned meanings and source mappings for this visualization. */
  readonly visualizationContext?: VisualizationBindingContext;
  /** Optional host scope annotations; validated against the Result descriptor. */
  readonly scope?: VarendoDataScope;
}

/** A semantic request from a rendered node; the host wraps it in its event envelope. */
export interface VarendoSemanticInteractionRequest {
  readonly nodeId: string;
  readonly portId: string;
  readonly payload: InteractionPayload;
}

export type VarendoSemanticInteractionHandler = (request: VarendoSemanticInteractionRequest) => void;

export interface VarendoRegionSnapshot {
  readonly presentation: ValidatedPresentation;
  readonly results: readonly VarendoRegionResult[];
}

export interface VarendoViewRenderContext {
  readonly node: ValidatedPresentation['nodes'][number];
  readonly result?: VarendoRegionResult;
  readonly children: () => TemplateResult | typeof nothing;
}

/** Trusted application code. A wire intent can select only a view registered here by the host. */
export interface VarendoViewDefinition {
  readonly ref: VersionRef;
  readonly manifest: PresentationManifest;
  render(context: VarendoViewRenderContext): TemplateResult | typeof nothing;
}

/** Component-level data requests with no implicit query or runtime effect. */
export type VarendoRegionDataRequest = Exclude<VarendoDataHostRequest, { readonly kind: 'selection' | 'filter' }>;
export type VarendoRegionDataRequestHandler = (request: VarendoRegionDataRequest) => void;
