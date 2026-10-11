/** Apply every disabled fieldset, including ancestors WebKit omits from :disabled. */
export function isFormControlDisabled(control: HTMLElement): boolean {
  if (control.matches(':disabled')) return true;
  let fieldset = control.closest('fieldset:disabled');
  while (fieldset !== null) {
    const firstLegend = fieldset.querySelector(':scope > legend');
    if (!firstLegend?.contains(control)) return true;
    fieldset = fieldset.parentElement?.closest('fieldset:disabled') ?? null;
  }
  return false;
}
