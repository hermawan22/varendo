declare const __VARENDO_SITE_BASE__: string;

/** Deployment path for the static site; application and package APIs are independent of it. */
export const SITE_BASE = typeof __VARENDO_SITE_BASE__ === 'string' ? __VARENDO_SITE_BASE__ : '/';
