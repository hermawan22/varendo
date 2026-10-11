import type { AeliqoDataHostRequest } from './data-renderer.js';
import type { InteractionPayload, ResultRef, VersionRef } from '@varendo/core';
import type { VisualizationBindingContext } from '@varendo/core/visualization';
import type { PresentationManifest, ValidatedPresentation } from '@varendo/core/presentation';
import type { TemplateResult } from 'lit';
import type { nothing } from 'lit';
import type { AeliqoTableColumn, AeliqoTableRow } from '../types.js';
import type { AeliqoDataScope } from '../data/types.js';

/** Rows already resolved by the application for one exact authorized ResultRef. */
export interface AeliqoRegionResult {
  readonly ref: ResultRef;
  readonly rows: readonly AeliqoTableRow[];
  readonly columns?: readonly AeliqoTableColumn[];
  /** Current host-owned meanings and source mappings for this visualization. */
  readonly visualizationContext?: VisualizationBindingContext;
  /** Optional host scope annotations; validated against the Result descriptor. */
  readonly scope?: AeliqoDataScope;
}

/** A semantic request from a rendered node; the host wraps it in its event envelope. */
export interface AeliqoSemanticInteractionRequest {
  readonly nodeId: string;
  readonly portId: string;
  readonly payload: InteractionPayload;
}

export type AeliqoSemanticInteractionHandler = (request: AeliqoSemanticInteractionRequest) => void;

export interface AeliqoRegionSnapshot {
  readonly presentation: ValidatedPresentation;
  readonly results: readonly AeliqoRegionResult[];
}

export interface AeliqoViewRenderContext {
  readonly node: ValidatedPresentation['nodes'][number];
  readonly result?: AeliqoRegionResult;
  readonly children: () => TemplateResult | typeof nothing;
}

/** Trusted application code. A wire intent can select only a view registered here by the host. */
export interface AeliqoViewDefinition {
  readonly ref: VersionRef;
  readonly manifest: PresentationManifest;
  render(context: AeliqoViewRenderContext): TemplateResult | typeof nothing;
}

/** Component-level data requests with no implicit query or runtime effect. */
export type AeliqoRegionDataRequest = Exclude<AeliqoDataHostRequest, { readonly kind: 'selection' | 'filter' }>;
export type AeliqoRegionDataRequestHandler = (request: AeliqoRegionDataRequest) => void;
