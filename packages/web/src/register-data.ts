import {
  AeliqoMetricElement,
  AeliqoDeltaElement,
  AeliqoKeyValueElement,
  AeliqoDetailElement,
  AeliqoRecordListElement,
  AeliqoCardCollectionElement,
  AeliqoSelectionSummaryElement,
  AeliqoFilterBuilderElement,
} from './data/index.js';
import type { ElementRegistration } from './register-elements.js';

export const registrations: readonly ElementRegistration[] = [
  { name: 'aeliqo-metric', constructor: AeliqoMetricElement },
  { name: 'aeliqo-delta', constructor: AeliqoDeltaElement },
  { name: 'aeliqo-key-value', constructor: AeliqoKeyValueElement },
  { name: 'aeliqo-detail', constructor: AeliqoDetailElement },
  { name: 'aeliqo-record-list', constructor: AeliqoRecordListElement },
  { name: 'aeliqo-card-collection', constructor: AeliqoCardCollectionElement },
  { name: 'aeliqo-selection-summary', constructor: AeliqoSelectionSummaryElement },
  { name: 'aeliqo-filter-builder', constructor: AeliqoFilterBuilderElement },
];
