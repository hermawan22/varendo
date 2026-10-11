import { css, LitElement } from 'lit';
import { aeliqoThemeStyles } from '../styles/theme.js';
import { AELIQO_WEB_VERSION } from '../version.js';

const AELIQO_FOUNDATION_VERSION = AELIQO_WEB_VERSION;

const aeliqoFoundationFocusStyles = css`
  :host {
    box-sizing: border-box;
  }

  :host,
  :host * {
    box-sizing: border-box;
  }

  :is(button, a, [role='separator']):focus-visible {
    outline: var(--aeliqo-focus-width, 0.1875rem) solid var(--aeliqo-color-focus, #4338ca);
    outline-offset: var(--aeliqo-focus-offset, 0.125rem);
    box-shadow: 0 0 0 0.25rem color-mix(in srgb, var(--aeliqo-color-focus, #4338ca) 16%, transparent);
  }
`;

export const aeliqoFoundationThemeStyles = [aeliqoThemeStyles, aeliqoFoundationFocusStyles] as const;

export abstract class AeliqoFoundationElement extends LitElement {
  static readonly aeliqoVersion = AELIQO_FOUNDATION_VERSION;

  static readonly shadowRootOptions: ShadowRootInit = {
    mode: 'open',
    delegatesFocus: true,
  };
}

export function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

const SAFE_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:', 'tel:']);

function parsedProtocol(value: string): string | undefined {
  try {
    return new URL(value, 'https://aeliqo.invalid').protocol.toLowerCase();
  } catch {
    return undefined;
  }
}

/** Accept only application-resolved destinations; model payloads never supply hrefs directly. */
export function safeResolvedHref(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0 || value.length > 4096) return undefined;
  const protocol = parsedProtocol(value);
  return protocol !== undefined && SAFE_PROTOCOLS.has(protocol) ? value : undefined;
}

export function initialsForName(name: string): string {
  const words = name
    .trim()
    .split(/\s+/u)
    .filter((word) => word.length > 0);
  if (words.length === 0) return '?';
  const first = [...(words[0] ?? '')][0] ?? '?';
  const last = words.length > 1 ? ([...(words[words.length - 1] ?? '')][0] ?? '') : '';
  return `${first}${last}`.toLocaleUpperCase().slice(0, 2);
}

export function imageHref(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0 || value.length > 4096) return undefined;
  const protocol = parsedProtocol(value);
  return protocol === 'http:' || protocol === 'https:' ? value : undefined;
}
