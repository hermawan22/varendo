import type { CatalogExampleId } from './types.js';

export const NAVIGATION_MOUNT_SOURCES = {
  tabs: String.raw`((root) => {
		const element = createCatalogElement<VarendoTabsElement>("varendo-tabs", root);
		element.items = tabs;
		element.value = "overview";
		element.activation = "manual";
	})`,
  breadcrumb: String.raw`((root) => {
		const element = createCatalogElement<VarendoBreadcrumbElement>("varendo-breadcrumb", root);
		element.items = breadcrumb;
		element.label = "Report path";
	})`,
  pagination: String.raw`((root) => {
		const element = createCatalogElement<VarendoPaginationElement>("varendo-pagination", root);
		element.page = 2;
		element.pageCount = 4;
		element.hasPrevious = true;
		element.hasNext = true;
		element.label = "Report pages";
	})`,
  menu: String.raw`((root) => {
		const element = createCatalogElement<VarendoMenuElement>("varendo-menu", root);
		element.items = menuItems;
		element.label = "Report actions";
		element.open = true;
	})`,
  'tree-nav': String.raw`((root) => {
		const element = createCatalogElement<VarendoTreeNavElement>("varendo-tree-nav", root);
		element.nodes = treeNodes;
		element.expandedIds = ["reports"];
		element.selectedId = "weekly";
		element.label = "Report navigation";
	})`,
} satisfies Partial<Record<CatalogExampleId, string>>;
