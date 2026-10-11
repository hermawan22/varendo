import type { CatalogExampleId } from './types.js';

export const DATA_MOUNT_SOURCES = {
  metric: String.raw`((root) => {
		const element = createCatalogElement<AeliqoMetricElement>("aeliqo-metric", root);
		element.label = "Authorized people";
		element.value = catalogRows.length;
		element.unit = "records";
		element.scope = catalogScope;
		element.description = "Current filtered result";
	})`,
  delta: String.raw`((root) => {
		const element = createCatalogElement<AeliqoDeltaElement>("aeliqo-delta", root);
		element.label = "Change from last week";
		element.current = .62;
		element.baseline = .5;
		element.mode = "percentage-point";
		element.unit = "%";
		element.scope = catalogScope;
	})`,
  'key-value': String.raw`((root) => {
		const element = createCatalogElement<AeliqoKeyValueElement>("aeliqo-key-value", root);
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
		const element = createCatalogElement<AeliqoDetailElement>("aeliqo-detail", root);
		element.title = "Person detail";
		element.record = catalogRows[0];
		element.fields = catalogColumns;
		element.identity = ["id"];
		element.entity = "person";
		element.scope = catalogScope;
	})`,
  'record-list': String.raw`((root) => {
		const element = createCatalogElement<AeliqoRecordListElement>("aeliqo-record-list", root);
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
		const element = createCatalogElement<AeliqoCardCollectionElement>("aeliqo-card-collection", root);
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
		const element = createCatalogElement<AeliqoTableElement>("aeliqo-table", root);
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
		const element = createCatalogElement<AeliqoFilterBuilderElement>("aeliqo-filter-builder", root);
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
		const element = createCatalogElement<AeliqoSelectionSummaryElement>("aeliqo-selection-summary", root);
		element.label = "People selected";
		element.entity = "person";
		element.selectedKeys = [personKeys[0], personKeys[1]];
		element.result = catalogRef;
		element.scope = catalogScope;
		element.clearable = true;
	})`,
} satisfies Partial<Record<CatalogExampleId, string>>;
