import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { AeliqoFieldElement } from '@varendo/web/inputs';
import { REVIEW_VARIANTS, reviewColorScheme, reviewViewport } from './review-variants.js';

const fields = [
  'text-field',
  'text-area',
  'number-field',
  'checkbox',
  'radio-group',
  'switch',
  'select',
  'combobox',
  'date-field',
  'date-range',
  'slider',
  'search-field',
  'file-input',
] as const;
const states = ['disabled', 'invalid', 'pending'] as const;
// Review captures only. No pixel baseline is created or accepted by this suite.
for (const id of fields)
  for (const state of [
    ...states,
    ...(['text-field', 'text-area', 'number-field'].includes(id) ? (['read-only'] as const) : []),
  ])
    for (const variant of REVIEW_VARIANTS) {
      test(`${id} ${state} ${variant}`, async ({ page }, info) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.setViewportSize(reviewViewport(variant));
        await page.emulateMedia({
          colorScheme: reviewColorScheme(variant),
          reducedMotion: 'reduce',
        });
        await page.goto(`/tests/visual/index.html?component=${id}&variant=${variant}`);
        await page.waitForFunction(() =>
          Boolean((window as typeof window & { aeliqoReviewReady?: boolean }).aeliqoReviewReady),
        );
        const field = page.locator(`#fixture aeliqo-${id}`).first();
        await field.evaluate(async (node, state) => {
          const element = node as AeliqoFieldElement;
          if (!('validationState' in element) || !('fieldDisabled' in element))
            throw new Error('Fixture is not a real field');
          if (state === 'disabled') element.disabled = true;
          if (state === 'read-only') element.readOnly = true;
          if (state === 'invalid') {
            element.error = 'This value needs review. Check the supplied value.';
            element.validationState = 'invalid';
          }
          if (state === 'pending') element.validationState = 'pending';
          await element.updateComplete;
        }, state);
        if (state === 'disabled') {
          const controls = field.locator('input, select, textarea');
          expect(await controls.count()).toBeGreaterThan(0);
          for (const control of await controls.all()) await expect(control).toBeDisabled();
        } else if (state === 'invalid') {
          await expect(field.locator('[part="error"]')).toHaveText(
            'This value needs review. Check the supplied value.',
          );
          if (id === 'text-field' && variant === 'narrow-dark-rtl') {
            const messageDirection = (part: 'description' | 'error' | 'pending') =>
              field.locator(`[part="${part}"]`).evaluate((element) => ({
                dir: element.getAttribute('dir'),
                direction: getComputedStyle(element).direction,
              }));
            expect(await field.evaluate((element) => getComputedStyle(element).direction)).toBe('rtl');
            expect(await messageDirection('description')).toEqual({ dir: 'auto', direction: 'ltr' });
            expect(await messageDirection('error')).toEqual({ dir: 'auto', direction: 'ltr' });
            await field.evaluate(async (node) => {
              const element = node as AeliqoFieldElement;
              element.description = 'تظهر هذه المساعدة في التقرير.';
              element.error = 'יש לבדוק את הערך שסופק.';
              await element.updateComplete;
            });
            expect(await messageDirection('description')).toEqual({ dir: 'auto', direction: 'rtl' });
            expect(await messageDirection('error')).toEqual({ dir: 'auto', direction: 'rtl' });
            await field.evaluate(async (node) => {
              const element = node as AeliqoFieldElement;
              element.description = 'تظهر هذه المساعدة في التقرير.';
              element.error = '';
              element.validationState = 'pending';
              await element.updateComplete;
            });
            expect(await messageDirection('description')).toEqual({ dir: 'auto', direction: 'rtl' });
            expect(await messageDirection('pending')).toEqual({ dir: 'auto', direction: 'ltr' });
            await field.evaluate(async (node) => {
              const element = node as AeliqoFieldElement;
              element.description = 'Used in the report header.';
              element.error = 'This value needs review. Check the supplied value.';
              element.validationState = 'invalid';
              await element.updateComplete;
            });
          }
          // Some composite fields carry invalid semantics on the host/fieldset.
          expect(
            await field.evaluate(
              (node) =>
                node.getAttribute('aria-invalid') === 'true' ||
                Boolean(node.shadowRoot?.querySelector('[aria-invalid="true"]')),
            ),
          ).toBe(true);
        } else if (state === 'read-only') {
          const control = field.locator('input, textarea').first();
          await expect(control).toHaveAttribute('readonly', '');
          const value = await control.inputValue();
          await control.focus();
          await page.keyboard.type('changed');
          await expect(control).toHaveValue(value);
        } else {
          await expect(field.locator('[part="pending"][role="status"]')).toHaveText('Checking…');
        }
        if (state === 'pending' || state === 'invalid') {
          const overlap = await field.evaluate((node, state) => {
            const message = node.shadowRoot?.querySelector(state === 'pending' ? '[part="pending"]' : '[part="error"]');
            const popup = node.shadowRoot?.querySelector('[part="listbox"]');
            if (!message || !popup) return false;
            const a = message.getBoundingClientRect(),
              b = popup.getBoundingClientRect();
            return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
          }, state);
          expect(overlap, 'The option popup must not cover validation feedback').toBe(false);
        }
        const axe = await new AxeBuilder({ page }).analyze();
        await info.attach('accessibility.json', {
          body: JSON.stringify({ violations: axe.violations, incomplete: axe.incomplete }, null, 2),
          contentType: 'application/json',
        });
        await info.attach('state.json', {
          body: JSON.stringify(
            {
              id,
              state,
              variant,
              browser: page.context().browser()?.version(),
              project: info.project.name,
              semantics: await field.ariaSnapshot(),
            },
            null,
            2,
          ),
          contentType: 'application/json',
        });
        await page.screenshot({ path: info.outputPath('review.png'), fullPage: true });
        expect(errors).toEqual([]);
        expect(axe.violations).toEqual([]);
      });
    }
