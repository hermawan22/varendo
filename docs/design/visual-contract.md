# Varendo visual contract

This is the current visual direction for the public site and component library.
It supersedes the proposal in the 0.3 work. The public site uses the same
token palette in light and dark modes, while applications using Varendo may
supply their own component tokens.

## Public site

Use off-white surfaces for reading pages and graphite surfaces for product
demos. Indigo is a restrained accent for links, focus, and primary actions. Use
the system sans-serif stack. Define spacing, type, color, borders, and radii as
site tokens so the landing page, documentation, component previews, and
playground share one visual system.

The public site offers light, dark, and system theme modes. A manual choice is
stored locally and follows the selected mode across public routes. Theme
changes do not change application data or the current playground intent. Keep reading layouts quiet and legible. Keep the
playground canvas prominent, with scenario controls easy to find and the
inspector available on demand. A consent notice must not cover the hero or the
main task.

## Component library

Component styles consume host-provided tokens and retain the library's
documented defaults. Host applications can adapt colors, spacing, typography,
and radii without changing component behavior. Public-site palette choices do
not constrain those host tokens.

## Component behavior

- Keep labels, help, errors, and pending states in predictable positions.
- Distinguish selected, disabled, invalid, and read-only states without color
  alone.
- Preserve visible keyboard focus and native keyboard behavior.
- Charts expose units, series identity, empty states, and reachable values.
- Tables keep headers associated with their values and show when horizontal
  scrolling is needed.
- Narrow layouts preserve the task. Do not replace exact comparison with a
  layout that hides required values.
- Use system fonts and named controls. Avoid decorative effects that reduce
  contrast or obscure data.

## Review sizes and states

Review the landing page, documentation index, component page, and playground at
360, 768, and 1440 CSS pixels. Check focus, hover, pressed, selected, disabled,
loading, error, and empty states where they apply. Also check 200% text size,
400% reflow, reduced motion, forced colors, long labels, and right-to-left
content. A passing token audit or a saved screenshot alone is not evidence of a
pixel-accurate result; inspect the rendered pages and keep the capture tied to
its commit and browser environment.
