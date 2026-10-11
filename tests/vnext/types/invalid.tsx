/**
 * DECLARATION-ONLY NEGATIVE CONSUMER, NOT AELIQO IMPLEMENTATION.
 * Each expected error protects a vNext trust or ownership boundary.
 */
import {
  AdaptiveSurface,
  connectAgent,
  type AgentClient,
  type DataFeatureDefinition,
  type FeatureDefinition,
  type Intent,
  type RuntimeObjectSchema,
  type ScopeController,
  type CapabilitySurfaceBindings,
  type SurfaceController,
  useSurface,
} from '../api-contract.js';

interface PersonIntent {
  readonly kind: 'browse';
  readonly filter?: { readonly team: 'Design' | 'Engineering' };
}

interface PersonState {
  readonly rows: readonly { readonly id: string }[];
}

declare const surface: SurfaceController<PersonIntent, PersonState>;
declare const feature: FeatureDefinition<PersonIntent>;
declare const scope: ScopeController;
declare const client: AgentClient;
declare const unrelatedBindings: CapabilitySurfaceBindings<{ readonly kind: 'layout' }, PersonState>;
declare const personSchema: RuntimeObjectSchema<{ readonly id: string }>;
declare const dataFeature: DataFeatureDefinition<typeof personSchema>;
declare const dataBypassBindings: CapabilitySurfaceBindings<Intent, PersonState>;

// @ts-expect-error an immutable feature definition is not a live surface controller
const wrongView = <AdaptiveSurface surface={feature} />;
void wrongView;

// @ts-expect-error credentials are never renderer props
const wrongCredential = <AdaptiveSurface surface={surface} apiKey="synthetic-only" />;
void wrongCredential;

// @ts-expect-error a surface address is immutable and cannot be repointed
surface.address.activationEpoch = 2;

// @ts-expect-error the optional agent bridge requires an explicit scope and target allowlist
connectAgent({ client });

// @ts-expect-error a workspace selector is not a ScopeController or authority grant
connectAgent({ scope: 'globex', client, targets: ['people-main'] });

// @ts-expect-error selection belongs to typed state, not an untyped snapshot convenience field
surface.getSnapshot().selection;

// @ts-expect-error natural-language model text is not a typed application intent
void surface.request('show everyone');

// @ts-expect-error semantically unknown filter values are rejected by the typed intent
void surface.request({ kind: 'browse', filter: { team: 'NotARegisteredTeam' } });

// @ts-expect-error a feature's parsed intent cannot be replaced by an unrelated binding intent
useSurface(feature, { id: 'wrong-feature-binding', bindings: unrelatedBindings });

// @ts-expect-error a data feature must use the existing DataService boundary, not a direct state callback
useSurface(dataFeature, { id: 'data-bypass', bindings: dataBypassBindings });
