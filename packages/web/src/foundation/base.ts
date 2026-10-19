import { css, LitElement } from 'lit';
import { varendoThemeStyles } from '../styles/theme.js';
import { VARENDO_WEB_VERSION } from '../version.js';

const VARENDO_FOUNDATION_VERSION = VARENDO_WEB_VERSION;

const varendoFoundationFocusStyles = css`
  :host {
    box-sizing: border-box;
  }

  :host,
  :host * {
    box-sizing: border-box;
  }

  :is(button, a, [role='separator']):focus-visible {
    outline: var(--varendo-focus-width, 0.1875rem) solid var(--varendo-color-focus, #4338ca);
    outline-offset: var(--varendo-focus-offset, 0.125rem);
    box-shadow: 0 0 0 0.25rem color-mix(in srgb, var(--varendo-color-focus, #4338ca) 16%, transparent);
  }
`;

export const varendoFoundationThemeStyles = [varendoThemeStyles, varendoFoundationFocusStyles] as const;

export abstract class VarendoFoundationElement extends LitElement {
  static readonly varendoVersion = VARENDO_FOUNDATION_VERSION;

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
    return new URL(value, 'https://varendo.invalid').protocol.toLowerCase();
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
