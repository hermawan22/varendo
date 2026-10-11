import type { ComponentType } from 'react';
import type { VersionRef } from '@varendo/core';
import type {
  RequestOptions,
  RequestResult,
  SurfaceController,
  SurfaceRequest,
  SurfaceSnapshot,
} from '@varendo/runtime/surfaces';

export interface ReactViewProps<I, S> {
  readonly surface: SurfaceController<I, S>;
  readonly snapshot: SurfaceSnapshot<I, S>;
  request(intent: SurfaceRequest<I>, options?: RequestOptions): Promise<RequestResult>;
}

/** Trusted local React code. It is not a wire-renderer registration. */
export type ReactViewInput<I, S> = VersionRef &
  (
    | { readonly render: ComponentType<ReactViewProps<I, S>>; readonly load?: never }
    | { readonly load: () => Promise<ComponentType<ReactViewProps<I, S>>>; readonly render?: never }
  );

export type ReactViewDefinition<I, S> = { readonly ref: VersionRef } & (
  | { readonly render: ComponentType<ReactViewProps<I, S>>; readonly load?: never }
  | { readonly load: () => Promise<ComponentType<ReactViewProps<I, S>>>; readonly render?: never }
);

export interface ReactViewRegistry<I, S> {
  readonly views: readonly ReactViewDefinition<I, S>[];
  resolve(ref: VersionRef): ReactViewDefinition<I, S> | undefined;
}
