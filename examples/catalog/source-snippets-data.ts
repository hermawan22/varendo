import type { CatalogExampleId } from './types.js';

export const DATA_MOUNT_SOURCES = {
  metric: String.raw`((root) => {
		const element = createCatalogElement<VarendoMetricElement>("varendo-metric", root);
		element.label = "Authorized people";
		element.value = catalogRows.length;
		element.unit = "records";
		element.scope = catalogScope;
		element.description = "Current filtered result";
	})`,
  delta: String.raw`((root) => {
		const element = createCatalogElement<VarendoDeltaElement>("varendo-delta", root);
		element.label = "Change from last week";
		element.current = .62;
		element.baseline = .5;
		element.mode = "percentage-point";
		element.unit = "%";
		element.scope = catalogScope;
	})`,
  'key-value': String.raw`((root) => {
		const element = createCatalogElement<VarendoKeyValueElement>("varendo-key-value", root);
		const items = [{
			key: "owner",
			label: "Owner",
			value: "Ada Lovelace"
		}, {
			key: "scope",
			label: "Scope",
			value: "Authorized people",
			description: "Current report scope"
		}];
		element.items = items;
		element.scope = catalogScope;
	})`,
  detail: String.raw`((root) => {
		const element = createCatalogElement<VarendoDetailElement>("varendo-detail", root);
		element.title = "Person detail";
		element.record = catalogRows[0];
		element.fields = catalogColumns;
		element.identity = ["id"];
		element.entity = "person";
		element.scope = catalogScope;
	})`,
  'record-list': String.raw`((root) => {
		const element = createCatalogElement<VarendoRecordListElement>("varendo-record-list", root);
		element.title = "People";
		element.rows = catalogRows;
		element.columns = catalogColumns;
		element.identity = ["id"];
		element.entity = "person";
		element.selection = "single";
		element.selectedKeys = [personKeys[0]];
		element.result = catalogRef;
		element.scope = catalogScope;
	})`,
  'card-collection': String.raw`((root) => {
		const element = createCatalogElement<VarendoCardCollectionElement>("varendo-card-collection", root);
		element.title = "People cards";
		element.rows = catalogRows;
		element.columns = catalogColumns;
		element.identity = ["id"];
		element.entity = "person";
		element.headingKey = "name";
		element.selection = "multiple";
		element.hasMore = true;
		element.loadingMore = false;
		element.scope = catalogScope;
	})`,
  table: String.raw`((root) => {
		const element = createCatalogElement<VarendoTableElement>("varendo-table", root);
		element.caption = "People";
		element.columns = tableColumns;
		element.rows = tableRows;
		element.identity = ["id"];
		element.entity = "person";
		element.selection = "multiple";
		element.selectedKeys = [personKeys[0]];
		element.result = catalogRef;
		element.page = 1;
		element.pageSize = 10;
		element.totalRows = catalogRows.length;
		element.scope = catalogScope;
	})`,
  'filter-builder': String.raw`((root) => {
		const element = createCatalogElement<VarendoFilterBuilderElement>("varendo-filter-builder", root);
		element.fields = catalogFields;
		element.entity = "person";
		element.scopeLabel = "Authorized people";
		element.autoApply = false;
		element.clauses = [{
			field: "team",
			operator: "eq",
			value: "Research"
		}];
		element.logical = "and";
	})`,
  'selection-summary': String.raw`((root) => {
		const element = createCatalogElement<VarendoSelectionSummaryElement>("varendo-selection-summary", root);
		element.label = "People selected";
		element.entity = "person";
		element.selectedKeys = [personKeys[0], personKeys[1]];
		element.result = catalogRef;
		element.scope = catalogScope;
		element.clearable = true;
	})`,
} satisfies Partial<Record<CatalogExampleId, string>>;
