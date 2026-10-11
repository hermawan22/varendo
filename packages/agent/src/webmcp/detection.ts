import type { WebMcpDetection, WebMcpDetectionOptions, WebMcpModelContext } from './types.js';
import { isRecord } from '../guards.js';

function isModelContext(value: unknown): value is WebMcpModelContext {
  return (
    isRecord(value) &&
    typeof value.registerTool === 'function' &&
    (value.getTools === undefined || typeof value.getTools === 'function')
  );
}

function modelContextFromDocument(documentLike: unknown): WebMcpModelContext | undefined {
  if (!isRecord(documentLike)) return undefined;
  try {
    const context = documentLike.modelContext;
    return isModelContext(context) ? context : undefined;
  } catch {
    return undefined;
  }
}

/** Inspect explicitly supplied host capabilities without reading browser globals. */
export function detectWebMcp(options: WebMcpDetectionOptions = {}): WebMcpDetection {
  const explicit = Object.hasOwn(options, 'document');
  const evidence = options.evidence ?? 'simulated';
  const context = explicit ? modelContextFromDocument(options.document) : undefined;
  if (context !== undefined) return Object.freeze({ evidence, supported: true, modelContext: context });
  return Object.freeze({
    evidence: explicit && evidence === 'simulated' ? 'simulated' : 'unavailable',
    supported: false,
    reason: 'The host does not expose document.modelContext.registerTool.',
  });
}
