import type { CatalogExampleId } from './types.js';

export const INPUT_MOUNT_SOURCES = {
  'text-field': String.raw`((root) => {
		const element = createCatalogElement<VarendoTextFieldElement>("varendo-text-field", root);
		element.label = "Display name";
		element.name = "displayName";
		element.value = "Ada Lovelace";
		element.description = "Used in the report header.";
		element.autocomplete = "name";
	})`,
  'text-area': String.raw`((root) => {
		const element = createCatalogElement<VarendoTextAreaElement>("varendo-text-area", root);
		element.label = "Notes";
		element.name = "notes";
		element.defaultValue = "Draft notes";
		element.rows = 4;
		element.spellcheck = true;
	})`,
  'number-field': String.raw`((root) => {
		const element = createCatalogElement<VarendoNumberFieldElement>("varendo-number-field", root);
		element.label = "Amount";
		element.name = "amount";
		element.locale = "en-US";
		element.text = "1,234.50";
		element.value = "1234.50";
		element.unit = "USD";
		element.min = "0";
	})`,
  checkbox: String.raw`((root) => {
		const element = createCatalogElement<VarendoCheckboxElement>("varendo-checkbox", root);
		element.label = "Include archived records";
		element.name = "includeArchived";
		element.value = "yes";
		element.checked = false;
	})`,
  'radio-group': String.raw`((root) => {
		const element = createCatalogElement<VarendoRadioGroupElement>("varendo-radio-group", root);
		element.label = "Report owner";
		element.name = "owner";
		element.options = options;
		element.value = "ada";
		element.orientation = "vertical";
	})`,
  switch: String.raw`((root) => {
		const element = createCatalogElement<VarendoSwitchElement>("varendo-switch", root);
		element.label = "Live updates";
		element.name = "live";
		element.checked = true;
	})`,
  select: String.raw`((root) => {
		const element = createCatalogElement<VarendoSelectElement>("varendo-select", root);
		element.label = "Team";
		element.name = "team";
		element.options = [
			{ value: "research", label: "Research" },
			{ value: "product", label: "Product" }
		];
		element.value = "research";
		element.emptyLabel = "Choose a team";
	})`,
  combobox: String.raw`((root) => {
		const element = createCatalogElement<VarendoComboboxElement>("varendo-combobox", root);
		element.label = "Person";
		element.name = "person";
		element.options = options;
		element.value = "ada";
		element.query = "Ada";
		element.open = true;
		element.minQueryLength = 1;
	})`,
  'date-field': String.raw`((root) => {
		const element = createCatalogElement<VarendoDateFieldElement>("varendo-date-field", root);
		element.label = "Report date";
		element.name = "reportDate";
		element.value = "2026-09-09";
		element.min = "2026-01-01";
		element.max = "2026-12-31";
		element.calendar = "gregory";
	})`,
  'date-range': String.raw`((root) => {
		const element = createCatalogElement<VarendoDateRangeElement>("varendo-date-range", root);
		element.label = "Reporting period";
		element.name = "period";
		element.start = "2026-09-01";
		element.end = "2026-09-30";
		element.boundary = "inclusive";
		element.timezone = "calendar";
	})`,
  slider: String.raw`((root) => {
		const element = createCatalogElement<VarendoSliderElement>("varendo-slider", root);
		element.label = "Confidence";
		element.name = "confidence";
		element.min = 0;
		element.max = 100;
		element.step = 5;
		element.value = 75;
		element.unit = "%";
	})`,
  'search-field': String.raw`((root) => {
		const element = createCatalogElement<VarendoSearchFieldElement>("varendo-search-field", root);
		element.label = "Search reports";
		element.name = "query";
		element.value = "retention";
		element.queryOnInput = true;
		element.debounceMs = 150;
		element.placeholder = "Search by name";
	})`,
  'file-input': String.raw`((root) => {
		const element = createCatalogElement<VarendoFileInputElement>("varendo-file-input", root);
		element.label = "Evidence file";
		element.name = "evidence";
		element.accept = ".csv,text/csv";
		element.multiple = false;
		element.maxFiles = 1;
		element.maxBytes = 2e6;
	})`,
  'field-group': String.raw`((root) => {
		const group = createCatalogElement<VarendoFieldGroupElement>("varendo-field-group", root);
		group.legend = "Profile details";
		group.description = "All fields are validated together.";
		const field = document.createElement("varendo-text-field") as VarendoTextFieldElement;
		field.label = "Preferred name";
		field.name = "preferredName";
		group.append(field);
	})`,
  form: String.raw`((root) => {
		const form = createCatalogElement<VarendoFormElement>("varendo-form", root);
		form.label = "Report filters";
		const field = document.createElement("varendo-text-field") as VarendoTextFieldElement;
		field.label = "Required filter";
		field.name = "filter";
		field.required = true;
		const submit = document.createElement("button");
		submit.type = "submit";
		submit.textContent = "Apply";
		form.append(field, submit);
	})`,
} satisfies Partial<Record<CatalogExampleId, string>>;
