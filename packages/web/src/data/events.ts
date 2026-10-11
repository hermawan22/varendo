import type {
  AeliqoFilterChangeDetail,
  AeliqoPageRequest,
  AeliqoSelectionDetail,
  AeliqoTableSortDetail,
  AeliqoTableWindowDetail,
} from './types.js';

export class AeliqoDataSelectionEvent extends CustomEvent<AeliqoSelectionDetail> {
  constructor(
    name: 'aeliqo-record-list-selection' | 'aeliqo-card-selection' | 'aeliqo-selection-clear',
    detail: AeliqoSelectionDetail,
  ) {
    super(name, { bubbles: true, composed: true, detail });
  }
}

export class AeliqoFilterChangeEvent extends CustomEvent<AeliqoFilterChangeDetail> {
  constructor(detail: AeliqoFilterChangeDetail) {
    super('aeliqo-filter-change', { bubbles: true, composed: true, detail });
  }
}

export class AeliqoTableSortEvent extends CustomEvent<AeliqoTableSortDetail> {
  constructor(detail: AeliqoTableSortDetail) {
    super('aeliqo-table-sort', { bubbles: true, composed: true, detail });
  }
}

export class AeliqoTablePageEvent extends CustomEvent<AeliqoPageRequest> {
  constructor(detail: AeliqoPageRequest) {
    super('aeliqo-table-page', { bubbles: true, composed: true, detail });
  }
}

export class AeliqoTableWindowEvent extends CustomEvent<AeliqoTableWindowDetail> {
  constructor(detail: AeliqoTableWindowDetail) {
    super('aeliqo-table-window', { bubbles: true, composed: true, detail });
  }
}

export class AeliqoDataLoadMoreEvent extends CustomEvent<{ readonly requested: true }> {
  constructor() {
    super('aeliqo-data-load-more', { bubbles: true, composed: true, detail: { requested: true } });
  }
}
