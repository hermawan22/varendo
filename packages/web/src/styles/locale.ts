export type AeliqoDirection = 'ltr' | 'rtl';

export interface AeliqoLocaleContext {
  readonly locale: string;
  readonly direction: AeliqoDirection;
}

export interface AeliqoLocaleOptions {
  /** Explicit host direction wins over platform locale inference. */
  readonly direction?: AeliqoDirection;
}

type AeliqoTextInfo = { readonly direction?: string };
type AeliqoLocaleWithTextInfo = Intl.Locale & {
  readonly getTextInfo?: () => AeliqoTextInfo;
};

function canonicalizeLocale(locale: string): AeliqoLocaleWithTextInfo {
  if (typeof locale !== 'string') {
    throw new TypeError('Varendo locale must be a BCP 47 language tag.');
  }

  const candidate = locale.trim();
  if (candidate.length === 0) {
    throw new RangeError('Varendo locale must be a non-empty BCP 47 language tag.');
  }

  try {
    // Intl.Locale both validates the language tag and returns its canonical form.
    return new Intl.Locale(candidate) as AeliqoLocaleWithTextInfo;
  } catch {
    throw new RangeError(`Invalid Varendo BCP 47 locale: ${locale}`);
  }
}

function validateDirection(direction: AeliqoDirection): AeliqoDirection {
  if (direction !== 'ltr' && direction !== 'rtl') {
    throw new RangeError(`Invalid Varendo text direction: ${String(direction)}`);
  }
  return direction;
}

function inferDirection(locale: AeliqoLocaleWithTextInfo): AeliqoDirection {
  const getTextInfo = locale.getTextInfo;
  if (typeof getTextInfo !== 'function') {
    throw new RangeError('The platform cannot infer locale direction; provide options.direction explicitly.');
  }

  let textInfo: AeliqoTextInfo;
  try {
    textInfo = getTextInfo.call(locale);
  } catch {
    throw new RangeError('The platform could not infer locale direction; provide options.direction explicitly.');
  }

  const direction = textInfo.direction;
  if (direction === 'ltr' || direction === 'rtl') return direction;
  throw new RangeError('The platform returned no usable locale direction; provide options.direction explicitly.');
}

/**
 * Resolve direction from an explicit host choice or the platform's BCP 47 text
 * metadata. The function deliberately does not guess from a short language list.
 */
export function resolveAeliqoDirection(locale: string, direction?: AeliqoDirection): AeliqoDirection {
  const canonicalLocale = canonicalizeLocale(locale);
  if (direction !== undefined) return validateDirection(direction);
  return inferDirection(canonicalLocale);
}

/** Create immutable, canonical locale metadata for a component or application scope. */
export function createAeliqoLocaleContext(locale = 'en-US', options: AeliqoLocaleOptions = {}): AeliqoLocaleContext {
  const canonicalLocale = canonicalizeLocale(locale);
  const resolvedDirection =
    options.direction === undefined ? inferDirection(canonicalLocale) : validateDirection(options.direction);
  return Object.freeze({
    locale: canonicalLocale.toString(),
    direction: resolvedDirection,
  });
}

/** Attributes that may be reflected onto a host without mutating document state. */
export function aeliqoLocaleAttributes(context: AeliqoLocaleContext): Readonly<{
  lang: string;
  dir: AeliqoDirection;
}> {
  return { lang: context.locale, dir: context.direction };
}
