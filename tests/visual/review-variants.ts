export const REVIEW_VARIANTS = ['desktop-light', 'medium-light', 'narrow-dark-rtl'] as const;

export type ReviewVariant = (typeof REVIEW_VARIANTS)[number];

export function reviewViewport(variant: ReviewVariant): { readonly width: number; readonly height: number } {
  switch (variant) {
    case 'desktop-light':
      return { width: 1440, height: 900 };
    case 'medium-light':
      return { width: 768, height: 900 };
    case 'narrow-dark-rtl':
      return { width: 360, height: 800 };
  }
}

export function reviewColorScheme(variant: ReviewVariant): 'light' | 'dark' {
  return variant === 'narrow-dark-rtl' ? 'dark' : 'light';
}

export function reviewDirection(variant: ReviewVariant): 'ltr' | 'rtl' {
  return variant === 'narrow-dark-rtl' ? 'rtl' : 'ltr';
}
