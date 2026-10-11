import { wireFailure } from '../diagnostics/wire.js';
import { WIRE_LIMITS as L } from './limits.js';
import type { Outcome } from './types.js';
import { cachedJSONBytes, jsonPrimitiveBytes } from './ingress-size.js';
import { inspectContainer, inspectProperty } from './ingress-container.js';
import { pathParts, type SummaryScope, type WireFrame, type WirePath, type WireSummary } from './ingress-walk-types.js';

type VisitFrame = Extract<WireFrame, { readonly kind: 'visit' }>;
type LeaveFrame = Extract<WireFrame, { readonly kind: 'leave' }>;

// Internal success signals carry no per-inspection state; public outcomes stay fresh.
const WALK_OK = Object.freeze({ ok: true, value: undefined });
const WALK_TRUE = Object.freeze({ ok: true, value: true });
const WALK_FALSE = Object.freeze({ ok: true, value: false });

class WireWalker {
  private readonly frames: WireFrame[];
  private readonly ancestors = new Set<object>();
  private readonly summaries = new WeakMap<object, WireSummary>();
  private readonly stringByteCache = new Map<string, number>();
  private nodes = 0;
  private encodedBytes = 0;

  constructor(private readonly input: unknown) {
    this.frames = [{ kind: 'visit', value: input, path: undefined, scope: undefined }];
  }

  inspect(): Outcome<unknown> {
    try {
      return this.scan();
    } catch {
      return wireFailure('wire.object', 'The supplied object could not be inspected as JSON.');
    }
  }

  private scan(): Outcome<unknown> {
    while (this.frames.length > 0) {
      const frame = this.frames.pop()!;
      const outcome = frame.kind === 'leave' ? this.leave(frame) : this.visit(frame);
      if (!outcome.ok) return outcome;
    }
    return { ok: true, value: this.input };
  }

  private leave(frame: LeaveFrame): Outcome<undefined> {
    this.ancestors.delete(frame.value);
    if (!this.addEncodedBytes(1)) return wireFailure('wire.bytes', 'The wire document exceeds its byte limit.');
    const scope = frame.scope;
    this.summaries.set(frame.value, {
      nodes: this.nodes - scope.startNodes,
      bytes: this.encodedBytes - scope.startBytes,
      maxRelativeDepth: scope.maxRelativeDepth,
    });
    this.propagateRelativeDepth(scope);
    return WALK_OK;
  }

  private propagateRelativeDepth(scope: SummaryScope): void {
    if (scope.parent === undefined) return;
    const relativeDepth = scope.baseDepth - scope.parent.baseDepth + scope.maxRelativeDepth;
    scope.parent.maxRelativeDepth = Math.max(scope.parent.maxRelativeDepth, relativeDepth);
  }

  private visit(frame: VisitFrame): Outcome<undefined> {
    const depth = frame.path?.depth ?? 0;
    if (depth > L.depth)
      return wireFailure(
        'wire.depth',
        'The wire document exceeds its depth limit.',
        pathParts(frame.path).slice(0, L.depth),
      );
    this.updateRelativeDepth(frame.scope, depth);

    const reused = this.reuseSummary(frame.value, depth, frame.scope, frame.path);
    if (!reused.ok) return reused;
    if (reused.value) return WALK_OK;

    const counted = this.countNode(frame.path);
    if (!counted.ok) return counted;
    return this.inspectValue(frame);
  }

  private updateRelativeDepth(scope: SummaryScope | undefined, depth: number): void {
    if (scope === undefined) return;
    scope.maxRelativeDepth = Math.max(scope.maxRelativeDepth, depth - scope.baseDepth);
  }

  private reuseSummary(
    value: unknown,
    depth: number,
    parentScope: SummaryScope | undefined,
    path: WirePath | undefined,
  ): Outcome<boolean> {
    if (value === null || typeof value !== 'object') return WALK_FALSE;
    if (this.ancestors.has(value)) {
      const counted = this.countNode(path);
      if (!counted.ok) return counted;
      return wireFailure('wire.cycle', 'Cyclic objects are not wire data.', pathParts(path));
    }

    const cached = this.summaries.get(value);
    if (cached === undefined) return WALK_FALSE;
    if (this.nodes + cached.nodes > L.nodes) return WALK_FALSE;
    if (this.encodedBytes + cached.bytes > L.bytes) return WALK_FALSE;
    if (depth + cached.maxRelativeDepth > L.depth) return WALK_FALSE;
    this.applySummary(cached, depth, parentScope);
    return WALK_TRUE;
  }

  private applySummary(summary: WireSummary, depth: number, parentScope: SummaryScope | undefined): void {
    this.nodes += summary.nodes;
    this.encodedBytes += summary.bytes;
    if (parentScope === undefined) return;
    parentScope.maxRelativeDepth = Math.max(
      parentScope.maxRelativeDepth,
      depth - parentScope.baseDepth + summary.maxRelativeDepth,
    );
  }

  private countNode(path: WirePath | undefined): Outcome<undefined> {
    this.nodes++;
    if (this.nodes > L.nodes)
      return wireFailure('wire.nodes', 'The wire document exceeds its node limit.', pathParts(path));
    return WALK_OK;
  }

  private inspectValue(frame: VisitFrame): Outcome<undefined> {
    const primitive = this.inspectPrimitive(frame.value, frame.path);
    if (!primitive.ok) return primitive;
    if (primitive.value) return WALK_OK;
    return this.enterContainer(frame);
  }

  private inspectPrimitive(current: unknown, path: WirePath | undefined): Outcome<boolean> {
    if (current === null || typeof current === 'boolean') return this.countPrimitive(jsonPrimitiveBytes(current));
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) return wireFailure('wire.number', 'Wire numbers must be finite.', pathParts(path));
      return this.countPrimitive(jsonPrimitiveBytes(current));
    }
    if (typeof current === 'string') {
      if (current.length > L.text)
        return wireFailure('wire.text', 'A wire string exceeds its length limit.', pathParts(path));
      return this.countPrimitive(cachedJSONBytes(current, this.stringByteCache));
    }
    if (typeof current !== 'object') return wireFailure('wire.type', 'Only JSON values are accepted.', pathParts(path));
    return WALK_FALSE;
  }

  private countPrimitive(bytes: number): Outcome<boolean> {
    if (!this.addEncodedBytes(bytes)) return wireFailure('wire.bytes', 'The wire document exceeds its byte limit.');
    return WALK_TRUE;
  }

  private enterContainer(frame: VisitFrame): Outcome<undefined> {
    const current = frame.value as object;
    const shape = inspectContainer(current, frame.path);
    if (!shape.ok) return shape;
    if (!this.addEncodedBytes(1)) return wireFailure('wire.bytes', 'The wire document exceeds its byte limit.');

    this.ancestors.add(current);
    const scope: SummaryScope = {
      baseDepth: frame.path?.depth ?? 0,
      startNodes: this.nodes - 1,
      startBytes: this.encodedBytes - 1,
      parent: frame.scope,
      maxRelativeDepth: 0,
    };
    this.frames.push({ kind: 'leave', value: current, scope });
    return this.scheduleProperties(current, shape.value, frame.path, scope);
  }

  private scheduleProperties(
    current: object,
    shape: { readonly isArray: boolean; readonly keys: PropertyKey[] },
    path: WirePath | undefined,
    scope: SummaryScope,
  ): Outcome<undefined> {
    let propertyIndex = 0;
    const depth = path?.depth ?? 0;
    for (let index = shape.keys.length - 1; index >= 0; index--) {
      const property = inspectProperty(current, shape.keys[index]!, shape.isArray, path);
      if (!property.ok) return property;
      if (property.value === undefined) continue;

      const key = shape.keys[index] as string; // inspectProperty rejects non-string keys.
      const bytes = this.propertySyntaxBytes(shape.isArray, key, propertyIndex);
      if (!this.addEncodedBytes(bytes)) return wireFailure('wire.bytes', 'The wire document exceeds its byte limit.');
      propertyIndex++;
      this.frames.push({
        kind: 'visit',
        value: property.value.value,
        scope,
        path: {
          parent: path,
          key: shape.isArray ? Number(key) : key,
          depth: depth + 1,
        },
      });
    }
    return WALK_OK;
  }

  private propertySyntaxBytes(isArray: boolean, key: string, propertyIndex: number): number {
    if (isArray) return Number(key) === 0 ? 0 : 1;
    const separator = propertyIndex === 0 ? 0 : 1;
    return cachedJSONBytes(key, this.stringByteCache) + 1 + separator;
  }

  private addEncodedBytes(bytes: number): boolean {
    this.encodedBytes += bytes;
    return this.encodedBytes <= L.bytes;
  }
}

export function inspectWireValue(input: unknown): Outcome<unknown> {
  return new WireWalker(input).inspect();
}
