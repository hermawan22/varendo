import type {
  VarendoFilterChangeDetail,
  VarendoPageRequest,
  VarendoSelectionDetail,
  VarendoTableSortDetail,
  VarendoTableWindowDetail,
} from './types.js';

export class VarendoDataSelectionEvent extends CustomEvent<VarendoSelectionDetail> {
  constructor(
    name: 'varendo-record-list-selection' | 'varendo-card-selection' | 'varendo-selection-clear',
    detail: VarendoSelectionDetail,
  ) {
    super(name, { bubbles: true, composed: true, detail });
  }
}

export class VarendoFilterChangeEvent extends CustomEvent<VarendoFilterChangeDetail> {
  constructor(detail: VarendoFilterChangeDetail) {
    super('varendo-filter-change', { bubbles: true, composed: true, detail });
  }
}

export class VarendoTableSortEvent extends CustomEvent<VarendoTableSortDetail> {
  constructor(detail: VarendoTableSortDetail) {
    super('varendo-table-sort', { bubbles: true, composed: true, detail });
  }
}

export class VarendoTablePageEvent extends CustomEvent<VarendoPageRequest> {
  constructor(detail: VarendoPageRequest) {
    super('varendo-table-page', { bubbles: true, composed: true, detail });
  }
}

export class VarendoTableWindowEvent extends CustomEvent<VarendoTableWindowDetail> {
  constructor(detail: VarendoTableWindowDetail) {
    super('varendo-table-window', { bubbles: true, composed: true, detail });
  }
}

export class VarendoDataLoadMoreEvent extends CustomEvent<{ readonly requested: true }> {
  constructor() {
    super('varendo-data-load-more', { bubbles: true, composed: true, detail: { requested: true } });
  }
}
