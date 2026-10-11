import type { CatalogExampleId } from './types.js';

export const COMPOUND_MOUNT_SOURCES = {
  explorer: String.raw`((root) => {
		const element = createCatalogElement<AeliqoExplorerElement>("aeliqo-explorer", root);
		element.fields = catalogFields;
		element.rows = catalogRows;
		element.columns = catalogColumns;
		element.identity = ["id"];
		element.entity = "person";
		element.selectedKey = "string:3:ada";
		element.detailRecord = catalogRows[0];
		element.detailFields = catalogColumns;
		element.result = catalogRef;
		element.scope = catalogScope;
		element.selection = "single";
	})`,
  comparison: String.raw`((root) => {
		const element = createCatalogElement<AeliqoComparisonElement>("aeliqo-comparison", root);
		element.compareSet = [{
			key: "ada",
			label: "Ada"
		}, {
			key: "grace",
			label: "Grace"
		}];
		element.compareKeys = ["ada", "grace"];
		element.entity = "person";
		element.metrics = [{
			id: "amount",
			label: "Amount",
			unit: "records",
			values: {
				ada: 120,
				grace: 144
			}
		}, {
			id: "team",
			label: "Team",
			values: {
				ada: "Research",
				grace: "Research"
			}
		}];
		element.result = catalogRef;
		element.scope = catalogScope;
	})`,
  breakdown: String.raw`((root) => {
		const element = createCatalogElement<AeliqoBreakdownElement>("aeliqo-breakdown", root);
		element.groups = [{
			key: "research",
			label: "Research",
			value: 264,
			unit: "records",
			recordCount: 2
		}, {
			key: "product",
			label: "Product",
			value: 96,
			unit: "records",
			recordCount: 1
		}];
		element.rows = catalogRows;
		element.columns = catalogColumns;
		element.identity = ["id"];
		element.entity = "person";
		element.result = catalogRef;
		element.scope = catalogScope;
	})`,
  investigation: String.raw`((root) => {
		const element = createCatalogElement<AeliqoInvestigationElement>("aeliqo-investigation", root);
		element.entity = "person";
		element.result = catalogRef;
		element.scope = catalogScope;
		element.baseline = 100;
		element.detailRecord = catalogRows[0];
		element.detailFields = catalogColumns;
		element.trend = catalogVisualizationSpecs.trend;
		element.trendContext = catalogVisualizationContext;
		element.trendDatasets = [catalogVisualizationDataset];
	})`,
  'search-results': String.raw`((root) => {
		const element = createCatalogElement<AeliqoSearchResultsElement>("aeliqo-search-results", root);
		element.query = "research";
		element.queryRevision = "query-2";
		element.resultRevision = catalogRef.revision;
		element.rows = catalogRows;
		element.columns = catalogColumns;
		element.identity = ["id"];
		element.selectedKey = "string:3:ada";
		element.entity = "person";
		element.result = catalogRef;
		element.scope = catalogScope;
		element.count = catalogRows.length;
		element.detailRecord = catalogRows[0];
		element.detailFields = catalogColumns;
	})`,
  'record-editor': String.raw`((root) => {
		const element = createCatalogElement<AeliqoRecordEditorElement>("aeliqo-record-editor", root);
		element.entity = "person";
		element.entityKey = "string:3:ada";
		element.entityRevision = "person-revision-1";
		const name = document.createElement("aeliqo-text-field") as AeliqoTextFieldElement;
		name.label = "Name";
		name.name = "name";
		name.value = "Ada Lovelace";
		const period = document.createElement("aeliqo-date-range") as AeliqoDateRangeElement;
		period.label = "Review period";
		period.name = "period";
		period.start = "2026-09-01";
		period.end = "2026-09-30";
		element.append(name, period);
	})`,
  'form-flow': String.raw`((root) => {
		const element = createCatalogElement<AeliqoFormFlowElement>("aeliqo-form-flow", root);
		element.steps = [{
			id: "identity",
			label: "Identity",
			fieldNames: ["name"]
		}, {
			id: "review",
			label: "Review",
			fieldNames: ["period"]
		}];
		element.activeStep = "identity";
		element.draft = { name: "Ada Lovelace" };
		const identity = document.createElement("div");
		identity.slot = "step-identity";
		const name = document.createElement("aeliqo-text-field") as AeliqoTextFieldElement;
		name.label = "Name";
		name.name = "name";
		name.value = "Ada Lovelace";
		identity.append(name);
		const review = document.createElement("div");
		review.slot = "step-review";
		review.textContent = "Review the authorized values before commit.";
		element.append(identity, review);
	})`,
  'quality-panel': String.raw`((root) => {
		const element = createCatalogElement<AeliqoQualityPanelElement>("aeliqo-quality-panel", root);
		element.source = "People registry";
		element.freshness = "2026-09-09 09:00 UTC";
		element.completeness = "3 of 3 rows loaded";
		element.provenance = ["Authorized local snapshot", "Query: catalog-query"];
		element.unsupportedClaims = ["This view does not establish causation."];
		element.state = {
			source: element.source,
			freshness: element.freshness,
			completeness: element.completeness,
			provenance: element.provenance,
			unsupportedClaims: element.unsupportedClaims
		};
	})`,
} satisfies Partial<Record<CatalogExampleId, string>>;
