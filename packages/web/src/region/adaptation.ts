import type { PresentationEnvironment } from '@varendo/core/presentation';
import {
  createCallbackPresentationRenderer,
  createPresentationAdaptationController,
  type PresentationAdaptationContextSource,
  type PresentationAdaptationController,
  type PresentationAdaptationReadInput,
  type PresentationAdaptationRequestOptions,
  type PresentationAdaptationResult,
  type PresentationAdaptationStatus,
  type PresentationNavigationState,
  type PresentationRenderer as RuntimePresentationRenderer,
} from '@varendo/runtime/presentation';
import type { VarendoRegionElement } from './varendo-region.js';
import type { RegionHandle, RegionOutcome } from '@varendo/runtime/regions';

const KNOWN = (value: number): { readonly state: 'known'; readonly value: number } => ({ state: 'known', value });
const UNKNOWN = { state: 'unknown' } as const;

export interface VarendoEnvironmentMeasurementOptions {
  readonly locale?: string;
  readonly direction?: 'ltr' | 'rtl';
  readonly textScale?: number;
  readonly pointer?: PresentationEnvironment['pointer'];
  readonly hover?: PresentationEnvironment['hover'];
  readonly keyboard?: PresentationEnvironment['keyboard'];
}

function boundedLocale(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64 || /[\u0000-\u001f\u007f]/u.test(value))
    return 'en-US';
  try {
    return new Intl.Locale(value).toString();
  } catch {
    return 'en-US';
  }
}

const ENVIRONMENT_QUERIES = [
  '(any-pointer: fine)',
  '(any-pointer: coarse)',
  '(pointer: fine)',
  '(pointer: coarse)',
  '(hover: hover)',
  '(hover: none)',
  '(prefers-reduced-motion: reduce)',
  '(forced-colors: active)',
] as const;

function media(target: Window | undefined, query: string): boolean | undefined {
  try {
    return target?.matchMedia(query).matches;
  } catch {
    return undefined;
  }
}

function regionWindow(element: Element | undefined): Window | undefined {
  const ownerWindow = element?.ownerDocument?.defaultView;
  if (ownerWindow !== null && ownerWindow !== undefined) return ownerWindow;
  return typeof window === 'undefined' ? undefined : window;
}

function sizeValue(value: number | undefined): PresentationEnvironment['inlineSize'] {
  if (value === undefined) return UNKNOWN;
  if (!Number.isFinite(value)) return UNKNOWN;
  if (value < 0) return UNKNOWN;
  return KNOWN(value);
}

function isVerticalWriting(style: CSSStyleDeclaration | undefined): boolean {
  const writingMode = style?.writingMode;
  return writingMode !== undefined && /^(vertical|sideways)/u.test(writingMode);
}

function rectSizes(
  rect: DOMRect | undefined,
  vertical: boolean,
): Pick<PresentationEnvironment, 'inlineSize' | 'blockSize'> {
  if (rect === undefined) return { inlineSize: UNKNOWN, blockSize: UNKNOWN };
  if (vertical) return { inlineSize: sizeValue(rect.height), blockSize: sizeValue(rect.width) };
  return { inlineSize: sizeValue(rect.width), blockSize: sizeValue(rect.height) };
}

function directionValue(
  style: CSSStyleDeclaration | undefined,
  option: PresentationEnvironment['direction'] | undefined,
): PresentationEnvironment['direction'] {
  if (option !== undefined) return option;
  if (style?.direction === 'ltr' || style?.direction === 'rtl') return style.direction;
  return 'ltr';
}

function textScaleValue(
  style: CSSStyleDeclaration | undefined,
  option: number | undefined,
): PresentationEnvironment['textScale'] {
  if (option !== undefined && Number.isFinite(option) && option > 0) return KNOWN(option);
  if (option !== undefined || style === undefined) return UNKNOWN;
  const fontSize = Number.parseFloat(style.fontSize);
  if (!Number.isFinite(fontSize) || fontSize <= 0) return UNKNOWN;
  return KNOWN(fontSize / 16);
}

function localeValue(
  element: Element | undefined,
  windowObject: Window | undefined,
  options: VarendoEnvironmentMeasurementOptions,
): string {
  if (options.locale !== undefined) return boundedLocale(options.locale);
  const language = element?.ownerDocument?.documentElement.lang;
  if (language !== undefined) return boundedLocale(language || 'en-US');
  return boundedLocale(windowObject?.navigator.language);
}

function measureSizes(
  element: Element | undefined,
  windowObject: Window | undefined,
  options: VarendoEnvironmentMeasurementOptions,
): Pick<PresentationEnvironment, 'inlineSize' | 'blockSize' | 'textScale' | 'direction' | 'locale'> {
  let sizes: Pick<PresentationEnvironment, 'inlineSize' | 'blockSize'> = {
    inlineSize: UNKNOWN,
    blockSize: UNKNOWN,
  };
  let textScale: PresentationEnvironment['textScale'] = textScaleValue(undefined, options.textScale);
  let direction = directionValue(undefined, options.direction);
  try {
    const rect = element?.getBoundingClientRect();
    const style =
      element === undefined || windowObject === undefined ? undefined : windowObject.getComputedStyle(element);
    sizes = rectSizes(rect, isVerticalWriting(style));
    direction = directionValue(style, options.direction);
    if (options.textScale === undefined) textScale = textScaleValue(style, undefined);
  } catch {
    // Unknown measurements remain explicit.
  }
  const locale = localeValue(element, windowObject, options);
  return { ...sizes, textScale, direction, locale };
}

function pointerFor(
  windowObject: Window | undefined,
  option: NonNullable<PresentationEnvironment['pointer']> | undefined,
): NonNullable<PresentationEnvironment['pointer']> {
  if (option !== undefined) return option;
  if (media(windowObject, '(any-pointer: fine)') === true && media(windowObject, '(any-pointer: coarse)') === true)
    return 'mixed';
  if (media(windowObject, '(pointer: fine)') === true) return 'fine';
  if (media(windowObject, '(pointer: coarse)') === true) return 'coarse';
  return 'unknown';
}

function hoverFor(
  windowObject: Window | undefined,
  option: NonNullable<PresentationEnvironment['hover']> | undefined,
): NonNullable<PresentationEnvironment['hover']> {
  if (option !== undefined) return option;
  if (media(windowObject, '(hover: hover)') === true) return 'available';
  if (media(windowObject, '(hover: none)') === true) return 'unavailable';
  return 'unknown';
}

/**
 * Read only platform facts. The helper never infers that a coarse pointer has
 * no keyboard, and returns unknown sizes when no browser measurement exists.
 */
export function measureVarendoRegionEnvironment(
  element: Element | undefined,
  options: VarendoEnvironmentMeasurementOptions = {},
): PresentationEnvironment {
  const windowObject = regionWindow(element);
  const sizes = measureSizes(element, windowObject, options);
  const reducedMotion = media(windowObject, '(prefers-reduced-motion: reduce)') === true;
  const forcedColors = media(windowObject, '(forced-colors: active)') === true;
  return {
    ...sizes,
    pointer: pointerFor(windowObject, options.pointer),
    hover: hoverFor(windowObject, options.hover),
    keyboard: options.keyboard ?? 'unknown',
    reducedMotion,
    forcedColors,
  };
}

export interface VarendoRegionAdaptationOptions {
  readonly element: VarendoRegionElement;
  readonly region: RegionHandle;
  readonly registry: Parameters<typeof createPresentationAdaptationController>[0]['registry'];
  readonly target?: Parameters<typeof createPresentationAdaptationController>[0]['target'];
  readonly baseContext: PresentationAdaptationContextSource;
  readonly readContext?: PresentationAdaptationContextSource;
  readonly renderer?: RuntimePresentationRenderer;
  readonly readNavigation?: () => PresentationNavigationState | undefined;
  readonly autoObserve?: boolean;
  readonly measure?: () => PresentationEnvironment;
  readonly requestOptions?: PresentationAdaptationRequestOptions;
  readonly now?: () => number;
  readonly schedule?: (callback: () => void, delayMilliseconds: number) => unknown;
  readonly cancelSchedule?: (handle: unknown) => void;
  readonly dwellMs?: number;
  readonly hysteresisPx?: number;
  readonly maxPendingRequests?: number;
  /** Host sets this while a focused editor, drag or IME composition owns the view. */
  readonly transitionBlocked?: () => boolean;
}

export interface VarendoRegionAdaptation {
  readonly controller: PresentationAdaptationController;
  readonly request: (
    environment?: PresentationEnvironment,
    options?: PresentationAdaptationRequestOptions,
  ) => Promise<RegionOutcome<PresentationAdaptationResult>>;
  measure(): PresentationEnvironment;
  disconnect(): void;
}

const EDITABLE_TAGS: ReadonlySet<string> = new Set(['input', 'textarea', 'select']);
const EDITABLE_ROLES: ReadonlySet<string> = new Set(['textbox', 'combobox', 'spinbutton']);

function editableTarget(value: Element | undefined): boolean {
  if (value === undefined) return false;
  const tag = value.localName;
  if (EDITABLE_TAGS.has(tag)) {
    return (
      !value.hasAttribute('disabled') &&
      !value.hasAttribute('readonly') &&
      value.getAttribute('aria-readonly') !== 'true'
    );
  }
  const contentEditable = value.getAttribute('contenteditable');
  if (contentEditable !== null && contentEditable !== 'false') return true;
  return EDITABLE_ROLES.has(value.getAttribute('role') ?? '');
}

function deepestActive(root: Document | Element): Element | undefined {
  const isDocument = typeof Document !== 'undefined' && root instanceof Document;
  let active: Element | undefined;
  if (isDocument) active = root.activeElement ?? undefined;
  else active = (root as Element).shadowRoot?.activeElement ?? undefined;
  while (active?.shadowRoot?.activeElement !== null && active?.shadowRoot?.activeElement !== undefined)
    active = active.shadowRoot.activeElement;
  return active;
}

function composedContains(container: Element, value: Element): boolean {
  let current: Node | null = value;
  while (current !== null) {
    if (current === container) return true;
    const root: Node = current.getRootNode();
    const host: unknown = (root as { readonly host?: unknown }).host;
    current = host !== undefined && host !== null ? (host as Node) : current.parentNode;
  }
  return false;
}

function hasFocusedEditable(element: VarendoRegionElement): boolean {
  const active = element.ownerDocument === undefined ? undefined : deepestActive(element.ownerDocument);
  // Focus inside nested shadow trees is reported by document.activeElement as
  // the outermost host. Walk the composed tree from the deepest active node so
  // the guard also covers regions mounted inside a consumer shadow root.
  return active !== undefined && composedContains(element, active) && editableTarget(active);
}

function elementRenderer(element: VarendoRegionElement): RuntimePresentationRenderer {
  let previous:
    | {
        readonly presentation: VarendoRegionElement['presentation'];
        readonly interaction: VarendoRegionElement['interaction'];
      }
    | undefined;
  return createCallbackPresentationRenderer({
    apply: (next) => {
      previous = { presentation: element.presentation, interaction: element.interaction };
      element.presentation = next.presentation;
      element.interaction = next.interaction;
      element.requestUpdate?.();
    },
    rollback: () => {
      if (previous === undefined) return;
      element.presentation = previous.presentation;
      element.interaction = previous.interaction;
      element.requestUpdate?.();
      previous = undefined;
    },
    clear: () => {
      previous = undefined;
      element.clear();
    },
  });
}

class RegionInteractionGuard {
  private compositionActive = false;
  private focusedEditable = false;
  private wasBlocked = false;
  private readonly activePointers = new Set<number>();
  private readonly documentObject: Document | undefined;
  private readonly windowObject: Window | null | undefined;

  constructor(
    private readonly element: VarendoRegionElement,
    private readonly transitionBlocked: (() => boolean) | undefined,
    private readonly onUnblocked: () => void,
  ) {
    this.documentObject = element.ownerDocument;
    this.windowObject = this.documentObject?.defaultView;
    this.attachListeners();
    this.sync();
  }

  isBlocked = (): boolean =>
    this.focusedEditable || this.compositionActive || this.activePointers.size > 0 || this.hostTransitionBlocked();

  hostTransitionBlocked = (): boolean => {
    try {
      return this.transitionBlocked?.() === true;
    } catch {
      return true;
    }
  };

  refresh = (): void => {
    this.focusedEditable = hasFocusedEditable(this.element);
  };

  dispose = (): void => {
    this.element.removeEventListener('focusin', this.onFocus, true);
    this.element.removeEventListener('focusout', this.onFocus, true);
    this.element.removeEventListener('compositionstart', this.onCompositionStart, true);
    this.element.removeEventListener('compositionend', this.onCompositionEnd, true);
    this.element.removeEventListener('pointerdown', this.onPointerStart, true);
    this.windowObject?.removeEventListener('blur', this.onWindowBlur, true);
    this.documentObject?.removeEventListener('pointerup', this.onPointerEnd, true);
    this.documentObject?.removeEventListener('pointercancel', this.onPointerEnd, true);
    this.documentObject?.removeEventListener('visibilitychange', this.onVisibilityChange, true);
    this.activePointers.clear();
  };

  private readonly onFocus = (): void => {
    queueMicrotask(this.sync);
  };

  private readonly onCompositionStart = (): void => {
    this.compositionActive = true;
    this.sync();
  };

  private readonly onCompositionEnd = (): void => {
    this.compositionActive = false;
    this.sync();
  };

  private readonly onPointerStart = (event: Event): void => {
    const pointerId = (event as PointerEvent).pointerId;
    if (this.activePointers.size < 16) this.activePointers.add(Number.isSafeInteger(pointerId) ? pointerId : -1);
    this.documentObject?.addEventListener('pointerup', this.onPointerEnd, true);
    this.documentObject?.addEventListener('pointercancel', this.onPointerEnd, true);
    this.sync();
  };

  private readonly onPointerEnd = (event: Event): void => {
    const pointerId = (event as PointerEvent).pointerId;
    if (Number.isSafeInteger(pointerId)) this.activePointers.delete(pointerId);
    else this.activePointers.clear();
    if (this.activePointers.size === 0) this.removePointerListeners();
    this.sync();
  };

  private readonly onWindowBlur = (): void => {
    this.activePointers.clear();
    this.removePointerListeners();
    this.sync();
  };

  private readonly onVisibilityChange = (): void => {
    if (this.documentObject?.visibilityState === 'hidden') this.onWindowBlur();
  };

  private readonly sync = (): void => {
    this.refresh();
    const blocked = this.isBlocked();
    if (this.wasBlocked && !blocked) this.onUnblocked();
    this.wasBlocked = blocked;
  };

  private attachListeners(): void {
    this.element.addEventListener('focusin', this.onFocus, true);
    this.element.addEventListener('focusout', this.onFocus, true);
    this.element.addEventListener('compositionstart', this.onCompositionStart, true);
    this.element.addEventListener('compositionend', this.onCompositionEnd, true);
    this.element.addEventListener('pointerdown', this.onPointerStart, true);
    this.windowObject?.addEventListener('blur', this.onWindowBlur, true);
    this.documentObject?.addEventListener('visibilitychange', this.onVisibilityChange, true);
  }

  private removePointerListeners(): void {
    this.documentObject?.removeEventListener('pointerup', this.onPointerEnd, true);
    this.documentObject?.removeEventListener('pointercancel', this.onPointerEnd, true);
  }
}

function addTransitionGuard(value: unknown, isBlocked: () => boolean): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  if (Object.hasOwn(value, 'ok')) {
    const outcome = value as { readonly ok?: unknown; readonly value?: unknown };
    if (outcome.ok === true) return { ok: true, value: addTransitionGuard(outcome.value, isBlocked) };
    return value;
  }
  return { ...(value as Record<string, unknown>), ...(isBlocked() ? { transitionBlocked: true } : {}) };
}

function createGuardedReadContext(
  options: VarendoRegionAdaptationOptions,
  isHostBlocked: () => boolean,
): PresentationAdaptationContextSource | undefined {
  if (options.readContext === undefined && options.transitionBlocked === undefined) return undefined;
  const source = options.readContext ?? options.baseContext;
  return ((input: PresentationAdaptationReadInput): unknown => {
    const raw = typeof source === 'function' ? source(input) : source;
    if (raw !== null && typeof raw === 'object' && typeof (raw as PromiseLike<unknown>).then === 'function')
      return Promise.resolve(raw).then((value) => addTransitionGuard(value, isHostBlocked));
    return addTransitionGuard(raw, isHostBlocked) as PresentationAdaptationContextSource;
  }) as PresentationAdaptationContextSource;
}

function createAdaptationController(
  options: VarendoRegionAdaptationOptions,
  renderer: RuntimePresentationRenderer,
  guard: RegionInteractionGuard,
  readContext: PresentationAdaptationContextSource | undefined,
): PresentationAdaptationController {
  return createPresentationAdaptationController({
    region: options.region,
    registry: options.registry,
    ...(options.target === undefined ? {} : { target: options.target }),
    baseContext: options.baseContext,
    ...(readContext === undefined ? {} : { readContext }),
    renderer,
    transitionBlocked: guard.isBlocked,
    ...(options.readNavigation === undefined ? {} : { readNavigation: options.readNavigation }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.schedule === undefined ? {} : { schedule: options.schedule }),
    ...(options.cancelSchedule === undefined ? {} : { cancelSchedule: options.cancelSchedule }),
    ...(options.dwellMs === undefined ? {} : { dwellMs: options.dwellMs }),
    ...(options.hysteresisPx === undefined ? {} : { hysteresisPx: options.hysteresisPx }),
    ...(options.maxPendingRequests === undefined ? {} : { maxPendingRequests: options.maxPendingRequests }),
  });
}

function observeEnvironmentMedia(element: Element | undefined, onChange: () => void): readonly MediaQueryList[] {
  const view = regionWindow(element);
  if (view === undefined || typeof view.matchMedia !== 'function') return [];
  const lists: MediaQueryList[] = [];
  for (const query of ENVIRONMENT_QUERIES) {
    const list = view.matchMedia(query);
    if (typeof list.addEventListener !== 'function') continue;
    list.addEventListener('change', onChange);
    lists.push(list);
  }
  return lists;
}

/** Bind a measured region element to the runtime adaptation transaction. */
export function createVarendoRegionAdaptation(options: VarendoRegionAdaptationOptions): VarendoRegionAdaptation {
  const measure = options.measure ?? (() => measureVarendoRegionEnvironment(options.element));
  const renderer = options.renderer ?? elementRenderer(options.element);
  let latestEnvironment: PresentationEnvironment | undefined;
  let latestRequestOptions: PresentationAdaptationRequestOptions | undefined;
  let needsRetry = false;
  let disposed = false;
  let retryAfterInteraction: () => void = () => {};
  const guard = new RegionInteractionGuard(options.element, options.transitionBlocked, () => {
    if (needsRetry) retryAfterInteraction();
  });
  const readContext = createGuardedReadContext(options, guard.hostTransitionBlocked);
  const controller = createAdaptationController(options, renderer, guard, readContext);
  const request = (
    environment = measure(),
    requestOptions = options.requestOptions,
  ): Promise<RegionOutcome<PresentationAdaptationResult>> => {
    // A programmatic focus can occur without a bubbling focus event reaching
    // this host. Refresh the conservative default guard at request time.
    guard.refresh();
    const currentlyBlocked = guard.isBlocked();
    latestEnvironment = environment;
    latestRequestOptions = requestOptions;
    if (currentlyBlocked) needsRetry = true;
    else needsRetry = false;
    const result = controller.request(environment, requestOptions);
    void result.then(
      (outcome) => {
        if (!outcome.ok && guard.isBlocked()) needsRetry = true;
      },
      () => undefined,
    );
    return result;
  };
  retryAfterInteraction = (): void => {
    if (disposed || !needsRetry || latestEnvironment === undefined || guard.isBlocked()) return;
    needsRetry = false;
    const requestOptions = { ...latestRequestOptions, force: true };
    const retry = request(latestEnvironment, requestOptions);
    void controller.flush();
    void retry;
  };
  let observer: ResizeObserver | undefined;
  let mediaLists: readonly MediaQueryList[] = [];
  const onMediaChange = (): void => {
    if (!disposed) void request();
  };
  if (options.autoObserve !== false) {
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        void request();
      });
      observer.observe(options.element);
    }
    mediaLists = observeEnvironmentMedia(options.element, onMediaChange);
  }
  return {
    controller,
    request,
    measure,
    disconnect: () => {
      disposed = true;
      observer?.disconnect();
      for (const list of mediaLists) list.removeEventListener('change', onMediaChange);
      guard.dispose();
      controller.dispose();
    },
  };
}

export type { PresentationAdaptationResult, PresentationAdaptationStatus };
