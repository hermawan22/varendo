import { describe, expect, it } from 'vitest';
import {
  createAgentCompositionRegistry,
  validateAgentComposition,
} from '../../../packages/agent/src/capabilities/composition.js';
import {
  type PresentationManifest,
  type PresentationContext,
  validatePresentationPlan,
} from '../../../packages/core/dist/presentation/index.js';
import { environment, experience, presentationPlan, presentationTask, result } from '../../contracts/fixtures.js';
const read = { id: 'data.read', revision: '1' };
const table: PresentationManifest = {
  ref: { id: 'data.table', revision: '1' },
  configSchema: { id: 'data.table.config', revision: '1' },
  roles: ['table'],
  operations: [read],
  result: 'required',
  children: { min: 0, max: 0 },
  visibility: 'leaf',
  extension: false,
  resolveConfig: (values, descriptor) =>
    Object.keys(values).length === 0 && descriptor !== undefined
      ? { ok: true, value: { values: {}, fields: descriptor.fields.map((f) => f.id), ports: [] } }
      : {
          ok: false,
          diagnostics: [{ code: 'table.config', message: 'Unsupported table configuration.', retryable: false }],
        },
};
const registry = createAgentCompositionRegistry([table]);
if (!registry.ok) throw new Error('registry');
const registered = registry.value;
const context = (): PresentationContext => ({
  task: {
    ...presentationTask,
    needs: [{ id: 'browse', operation: read, fields: ['employee.id'], outputId: 'rows', required: true }],
  },
  experience: { ...experience, mode: 'composable', allowedRepresentations: ['data.table'] },
  results: [result],
  current: presentationPlan.preconditions,
  environment,
  rendererCapabilities: [table.ref],
});
const plan = () => ({
  ...presentationPlan,
  coverage: [{ needId: 'browse', nodeIds: ['table-1'], operations: [read] }],
});
describe('canonical agent composition', () => {
  it('resolves the same graph, actual fields and descriptors as manual authoring', () => {
    const actual = validateAgentComposition(plan(), registered, context());
    const manual = validatePresentationPlan(plan(), context(), registered);
    expect(actual.ok).toBe(true);
    expect(manual.ok).toBe(true);
    if (!actual.ok || !manual.ok) return;
    expect(actual.value.plan).toEqual(manual.value.plan);
    expect(actual.value.nodes).toEqual(manual.value.nodes);
    expect(actual.value.resultReferences).toEqual([result.ref]);
  });
  it.each(['coverage', 'scope', 'renderer', 'config', 'approval', 'result'] as const)(
    'rejects %s through the same manual validator',
    (kind) => {
      let input: unknown = plan();
      let ctx = context();
      if (kind === 'coverage') input = { ...plan(), coverage: [] };
      if (kind === 'scope') ctx = { ...ctx, current: { ...ctx.current, scopeDigest: 'revoked' } };
      if (kind === 'renderer') ctx = { ...ctx, rendererCapabilities: [] };
      if (kind === 'config')
        input = {
          ...plan(),
          nodes: [
            { ...plan().nodes[0]!, config: { schema: table.configSchema, values: { html: '<script>code</script>' } } },
          ],
        };
      if (kind === 'approval') input = { ...plan(), approved: true };
      if (kind === 'result') ctx = { ...ctx, results: [] };
      const manual = validatePresentationPlan(input, ctx, registered);
      expect(manual.ok).toBe(false);
      expect(validateAgentComposition(input, registered, ctx)).toEqual(manual);
    },
  );
});
