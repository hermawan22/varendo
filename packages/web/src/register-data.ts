import {
  VarendoMetricElement,
  VarendoDeltaElement,
  VarendoKeyValueElement,
  VarendoDetailElement,
  VarendoRecordListElement,
  VarendoCardCollectionElement,
  VarendoSelectionSummaryElement,
  VarendoFilterBuilderElement,
} from './data/index.js';
import type { ElementRegistration } from './register-elements.js';

export const registrations: readonly ElementRegistration[] = [
  { name: 'varendo-metric', constructor: VarendoMetricElement },
  { name: 'varendo-delta', constructor: VarendoDeltaElement },
  { name: 'varendo-key-value', constructor: VarendoKeyValueElement },
  { name: 'varendo-detail', constructor: VarendoDetailElement },
  { name: 'varendo-record-list', constructor: VarendoRecordListElement },
  { name: 'varendo-card-collection', constructor: VarendoCardCollectionElement },
  { name: 'varendo-selection-summary', constructor: VarendoSelectionSummaryElement },
  { name: 'varendo-filter-builder', constructor: VarendoFilterBuilderElement },
];
