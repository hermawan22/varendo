import type { CatalogExampleId } from './types.js';

export const FOUNDATION_MOUNT_SOURCES = {
  button: String.raw`((root) => {
		const element = createCatalogElement<AeliqoButtonElement>("aeliqo-button", root);
		element.label = "Save report";
		element.variant = "solid";
		element.type = "button";
	})`,
  'icon-button': String.raw`((root) => {
		const element = createCatalogElement<AeliqoIconButtonElement>("aeliqo-icon-button", root);
		element.label = "Open details";
		appendSlottedText(element, "icon", "⋯");
	})`,
  link: String.raw`((root) => {
		const element = createCatalogElement<AeliqoLinkElement>("aeliqo-link", root);
		element.label = "View report";
		element.href = "/reports/weekly";
		element.target = "_self";
	})`,
  text: String.raw`((root) => {
		const element = createCatalogElement<AeliqoTextElement>("aeliqo-text", root);
		element.text = "A plain, trusted text value.";
		element.as = "p";
	})`,
  heading: String.raw`((root) => {
		const element = createCatalogElement<AeliqoHeadingElement>("aeliqo-heading", root);
		element.level = 2;
		element.size = "heading";
		element.text = "Weekly report";
	})`,
  badge: String.raw`((root) => {
		const element = createCatalogElement<AeliqoBadgeElement>("aeliqo-badge", root);
		element.text = "Ready";
		element.tone = "success";
	})`,
  avatar: String.raw`((root) => {
		const element = createCatalogElement<AeliqoAvatarElement>("aeliqo-avatar", root);
		element.name = "Ada Lovelace";
		element.alt = "Ada Lovelace";
		element.size = "medium";
	})`,
  separator: String.raw`((root) => {
		const element = createCatalogElement<AeliqoSeparatorElement>("aeliqo-separator", root);
		element.orientation = "horizontal";
	})`,
  surface: String.raw`((root) => {
		const element = createCatalogElement<AeliqoSurfaceElement>("aeliqo-surface", root);
		element.as = "section";
		element.tone = "surface";
		element.label = "Report panel";
		element.textContent = "Bounded surface content";
	})`,
  stack: String.raw`((root) => {
		const element = createCatalogElement<AeliqoStackElement>("aeliqo-stack", root);
		element.direction = "row";
		element.gap = 12;
		element.align = "center";
		for (const text of ["First", "Second"]) {
			const item = document.createElement("span");
			item.textContent = text;
			element.append(item);
		}
	})`,
  grid: String.raw`((root) => {
		const element = createCatalogElement<AeliqoGridElement>("aeliqo-grid", root);
		element.columns = 2;
		element.gap = 16;
		element.minItem = "small";
		for (const text of ["Left", "Right"]) {
			const item = document.createElement("span");
			item.textContent = text;
			element.append(item);
		}
	})`,
  'split-pane': String.raw`((root) => {
		const element = createCatalogElement<AeliqoSplitPaneElement>("aeliqo-split-pane", root);
		element.defaultPosition = 42;
		element.min = 20;
		element.max = 80;
		element.primaryLabel = "Primary panel";
		element.secondaryLabel = "Secondary panel";
		appendSlottedText(element, "start", "Primary panel");
		appendSlottedText(element, "end", "Secondary panel");
	})`,
  'scroll-area': String.raw`((root) => {
		const element = createCatalogElement<AeliqoScrollAreaElement>("aeliqo-scroll-area", root);
		element.axis = "y";
		element.label = "Report rows";
		element.tabIndex = 0;
		const content = document.createElement("p");
		content.textContent = "Scrollable report content that retains focus visibility.";
		element.append(content);
	})`,
} satisfies Partial<Record<CatalogExampleId, string>>;
