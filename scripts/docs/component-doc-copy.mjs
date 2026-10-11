const words = (value) =>
  value
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replaceAll('-', ' ')
    .toLocaleLowerCase();

const PROPERTY_COPY = Object.freeze({
  accept:
    'Lists the file types the picker should offer. The host must still validate selected metadata and file content.',
  action: 'Identifies the registered action proposed by this control. Application code authorizes and executes it.',
  activation: 'Chooses automatic or manual tab activation. Use manual activation when panel work is not immediate.',
  alt: 'Provides alternative text for a meaningful image. Leave it empty only when the image is decorative.',
  autocomplete: 'Passes an autocomplete purpose to the native input so browsers can offer an appropriate saved value.',
  baseline:
    'Supplies the comparison baseline and its evidence. The component does not infer a baseline from visible rows.',
  boundary: 'Declares whether the date range includes or excludes its endpoints.',
  calendar: 'Names the calendar used to interpret date values. Keep it aligned with the resource temporal policy.',
  caption: 'Provides the visible table caption and accessible name for the data relationship.',
  capture: 'Hints which device camera should satisfy a file capture request on supporting browsers.',
  checked: 'Controls the current boolean state. Update it from accepted change proposals.',
  clauses: 'Supplies the current filter clauses. Application code owns query execution and authoritative filter state.',
  columns: 'Defines ordered visible fields, labels, formatting, alignment, and supported column interactions.',
  compatible: 'States whether compared values share compatible meaning and units. The host computes this fact.',
  completeness: 'Describes the known completeness of the evidence shown in the quality panel.',
  content: 'Provides trusted plain content for the overlay. Do not pass untrusted HTML.',
  context: 'Supplies the validated catalog and result context used to bind the visualization specification.',
  count: 'Provides the result count shown to the user. It must match the associated result revision and scope.',
  current: 'Supplies the current comparison value. The component displays it without recomputing the metric.',
  datasets: 'Supplies rows keyed to the declared Result references. The component does not fetch or expand them.',
  debounceMs: 'Sets the delay before an input-driven search proposal is emitted.',
  decorative: 'Marks the visual as decorative so it is removed from the accessibility tree.',
  description: 'Provides supporting text associated with the control or value.',
  disabled: 'Prevents user interaction while keeping the control and its current value visible.',
  dismissible: 'Shows a user dismissal control. The host still removes or updates the message after the event.',
  displayValue: 'Provides the exact preformatted value shown to users when host formatting is authoritative.',
  draft: 'Supplies the current multi-step form draft. The host remains the source of truth across steps.',
  duration:
    'Sets the visible toast duration in milliseconds. Use a persistent alert for information that must be acknowledged.',
  emptyLabel: 'Provides the text shown when no value or row is available.',
  end: 'Controls the committed end of the date range.',
  entity: 'Names the catalog entity whose records and identities are displayed.',
  error: 'Provides the current validation or operation error associated with the control.',
  fields: 'Defines the fields available to this control, including stable IDs, labels, and declared types.',
  format: 'Selects the declared value format. It changes presentation without changing metric meaning.',
  freshness: 'Describes when the evidence was observed and whether it may be stale.',
  gap: 'Sets spacing between layout children using a CSS length.',
  groups: 'Supplies the bounded grouped values and stable group identities used by the breakdown.',
  heading: 'Provides the visible overlay or feedback heading and its accessible label.',
  height: 'Sets the visualization layout height. The chart still computes mark geometry from its measured container.',
  href: 'Provides an application-approved navigation destination.',
  identity: 'Lists stable identity fields used for selection, detail targeting, and state transfer.',
  inherited: 'Supplies read-only predicates inherited from an outer application scope.',
  invalid: 'Marks the current editor state invalid and blocks a valid save proposal.',
  items: 'Supplies the ordered bounded items with stable IDs and display labels.',
  kind: 'Selects the semantic empty-state treatment; it does not change application behavior.',
  label: 'Provides the visible label and accessible name for the component.',
  labelledBy: 'References the ID of host text that labels this surface.',
  legend: 'Provides the field-group legend announced before its child controls.',
  level: 'Sets the semantic heading level while preserving the component visual style.',
  locale: 'Selects locale-sensitive formatting and parsing behavior.',
  logical: 'Chooses whether filter clauses are joined with AND or OR.',
  maxBytes:
    'Sets the maximum accepted size for each selected file. The host must enforce the same limit before upload.',
  maxFiles: 'Sets the maximum number of selected files.',
  maxMarks: 'Limits rendered visualization marks. Results above this boundary must be reduced or rejected explicitly.',
  message: 'Provides the user-facing status, error, or recovery message.',
  metrics: 'Supplies the declared metrics shown in the comparison, including compatible meaning and units.',
  minItem: 'Sets the minimum grid item width before layout wraps to another row.',
  minQueryLength: 'Sets the number of query characters required before a combobox query proposal is useful.',
  missingLabel: 'Provides the text used for a declared field whose value is missing.',
  modal: 'Chooses modal focus containment and background interaction behavior.',
  multiple: 'Allows selection of more than one file.',
  muted: 'Applies the lower-emphasis text treatment without changing semantics.',
  name: 'Provides the stable form or action name used by the host to identify this control.',
  nodes: 'Supplies the navigation hierarchy with stable node IDs and bounded children.',
  noValidate: 'Disables native form validation when application validation owns the complete flow.',
  open: 'Controls whether the overlay or expandable surface is currently open.',
  options:
    'Supplies the complete bounded choice list, including stable values, labels, descriptions, and disabled states.',
  optionsLoader:
    'Loads bounded combobox options for the current query. The host owns cancellation, authorization, and failures.',
  orientation: 'Sets the horizontal or vertical orientation and associated keyboard behavior.',
  overscan: 'Sets the extra virtualized rows rendered outside the visible window.',
  page: 'Controls the current one-based page.',
  pageCount: 'Provides the total known page count used to label and bound navigation.',
  pageSize: 'Sets the number of rows represented by one table page.',
  pattern: 'Provides the native validation pattern for text input.',
  pending: 'Marks an action as in progress and prevents repeated activation until the host clears it.',
  placeholder: 'Provides a short input hint when the current draft is empty; it does not replace a visible label.',
  position: 'Controls the current split position within the declared minimum and maximum.',
  predicate: 'Supplies the validated filter predicate represented by the current control state.',
  provenance: 'Supplies evidence about where the displayed result came from.',
  query: 'Supplies the current search or combobox query independently from a committed selection.',
  queryOnInput: 'Chooses whether typing emits debounced search proposals before explicit commit.',
  readOnly: 'Keeps the current value focusable and readable while preventing edits.',
  record: 'Supplies the selected record that matches the declared identity and result scope.',
  required: 'Marks the control as required for validation and native accessibility semantics.',
  result: 'Supplies the Result reference that binds displayed data to its query and scope evidence.',
  rows: 'Supplies the bounded records to render. The component never fetches or widens this set.',
  scope: 'Supplies the visible authorization and population scope associated with the displayed value or rows.',
  selected: 'Supplies selected file metadata; application code owns file content and upload state.',
  selectedGroup: 'Controls the currently selected breakdown group by stable group identity.',
  selectedId: 'Controls the currently selected navigation node by stable ID.',
  selectedIdentity: 'Controls the selected visualization identity and keeps it tied to the current Result.',
  selectedKey: 'Controls the current record selection by stable encoded identity.',
  selectedKeys: 'Controls the current collection selection using stable encoded identities.',
  selectedResult: 'Identifies the Result whose marks are currently selected.',
  selection: 'Chooses none, single, or multiple selection behavior.',
  selectionEnabled: 'Enables mark selection proposals for the visualization.',
  selectionScope: 'Declares whether selected identities refer to loaded rows or a broader explicit predicate scope.',
  showIdentity: 'Shows the stable identity fields alongside the detail values.',
  side: 'Chooses the edge from which the drawer opens.',
  size: 'Selects the component size from its bounded visual variants.',
  sort: 'Supplies the current table sort so controls reflect authoritative host state.',
  source: 'Provides the source label shown with quality evidence.',
  spellcheck: 'Enables or disables browser spelling suggestions for text drafts.',
  src: 'Provides an application-approved image source for the avatar.',
  start: 'Controls the committed start of the date range.',
  state: 'Supplies the overall quality state summarized by the panel.',
  status: 'Supplies the explicit ready, loading, empty, partial, stale, or error state.',
  step: 'Sets the permitted numeric or split-position increment.',
  steps: 'Supplies the ordered form-flow steps with stable IDs and labels.',
  tabIndex: 'Controls whether the scroll viewport participates in the host tab order.',
  target: 'Selects the approved browser navigation target.',
  text: 'Provides trusted plain text content. The component never interprets it as HTML.',
  timezone: 'Names the timezone used to interpret temporal boundaries.',
  title: 'Provides the visible title for the current data or compound surface.',
  tone: 'Selects a semantic visual tone such as neutral, informative, success, warning, or danger.',
  totalRows: 'Provides the total known row count used for paging and scope disclosure.',
  unit: 'Provides the unit label associated with the numeric value.',
  unknownLabel: 'Provides recovery text when a controlled select value is absent from the supplied options.',
  unsupportedClaims: 'Lists claims that available evidence cannot support so they remain visibly qualified.',
  validation: 'Supplies authoritative validation results for the current form-flow draft.',
  validationState: 'Controls the current idle, pending, valid, or invalid validation state.',
  validator: 'Runs host-provided synchronous validation for a proposed input value.',
  value: 'Controls the current value. Apply accepted user proposals back to this property.',
  variant: 'Selects one of the documented visual variants without changing the component contract.',
  virtualCount: 'Sets the total virtual row count represented by the current window.',
  virtualized: 'Enables explicit windowed table rendering for large bounded results.',
  virtualStart: 'Sets the first row index represented by the supplied virtual window.',
  visualization: 'Supplies the validated visualization specification to render.',
  width: 'Sets the visualization layout width before measured container geometry is applied.',
  wrap: 'Chooses whether layout children wrap when inline space runs out.',
});

const PROPERTY_PATTERN_RULES = Object.freeze([
  [
    ({ name }) => name.startsWith('default'),
    (label, { name }) =>
      `Provides the initial uncontrolled ${words(name.slice(7))}. Later updates come from component interaction.`,
  ],
  [
    ({ name }) => name.endsWith('Label'),
    (label, { name }) => `Provides the visible text for the ${words(name.slice(0, -5))} control or section.`,
  ],
  [
    ({ name }) => name.endsWith('Revision'),
    (label, { name }) =>
      `Identifies the ${words(name.slice(0, -8))} version so stale state can be detected explicitly.`,
  ],
  [
    ({ name }) => name.startsWith('has'),
    (label, { name }) =>
      `Declares whether ${words(name.slice(3))} is available. The host updates it with the underlying data state.`,
  ],
  [
    ({ name }) => name.startsWith('selected'),
    (label) => `Controls the current ${label} using stable application-owned identity.`,
  ],
  [({ name }) => name.startsWith('max'), (label) => `Sets the upper bound for ${label}.`],
  [({ name }) => name.startsWith('min'), (label) => `Sets the lower bound for ${label}.`],
  [({ type }) => /boolean/u.test(type), (label) => `Enables or disables ${label} as explicit host-controlled state.`],
  [
    ({ type }) => /readonly|\[\]/u.test(type),
    (label) => `Supplies the bounded ordered ${label} collection used by this component.`,
  ],
]);

function patternedPropertyCopy(property) {
  const label = words(property.name);
  const rule = PROPERTY_PATTERN_RULES.find(([predicate]) => predicate(property));
  return rule ? rule[1](label, property) : `Supplies ${label} to the component as application-owned input.`;
}

export function propertyDescription(property) {
  return PROPERTY_COPY[property.name] ?? patternedPropertyCopy(property);
}

const EVENT_COPY = Object.freeze({
  'aeliqo-action': [
    '`{source, action, type}`',
    'After a user activates the button or link.',
    'Authorize the action, perform the effect, and update pending or navigation state.',
  ],
  'aeliqo-alert-action': [
    'The configured alert action identifier.',
    'After the user activates the alert action.',
    'Authorize and perform the action, then update or dismiss the alert.',
  ],
  'aeliqo-alert-dismiss': [
    'Dismissal context for the current alert.',
    'After the user requests dismissal.',
    'Remove or retain the alert according to application policy.',
  ],
  'aeliqo-breakdown-group': [
    'The selected stable group key.',
    'After the user selects a breakdown row.',
    'Validate the group against the current result and update the controlled selection.',
  ],
  'aeliqo-card-selection': [
    'Stable selected identity keys plus result lineage.',
    'After card selection changes.',
    'Validate scope and identity, then update `selectedKeys`.',
  ],
  'aeliqo-combobox-query': [
    '`{source, query}`',
    'While the user edits the combobox query.',
    'Cancel obsolete loads, fetch authorized bounded options, and update `options`.',
  ],
  'aeliqo-comparison-set': [
    'The proposed bounded comparison identity set.',
    'After the user changes compared records.',
    'Validate compatible identities and update the controlled comparison set.',
  ],
  'aeliqo-data-load-more': [
    '`{requested: true}`',
    'After the user requests the next bounded card page.',
    'Fetch the next authorized page and update rows, `hasMore`, and `loadingMore`.',
  ],
  'aeliqo-data-selection': [
    'Stable selected identity keys and lineage.',
    'After a child data surface changes selection.',
    'Validate identity and scope before updating host selection state.',
  ],
  'aeliqo-dialog-close': [
    'The close reason supplied by the dialog.',
    'After Escape, a close control, or an allowed dismissal.',
    'Set `open` to false and restore focus to the opener.',
  ],
  'aeliqo-drawer-close': [
    'The close reason supplied by the drawer.',
    'After Escape or a close control.',
    'Set `open` to false and restore focus to the opener.',
  ],
  'aeliqo-empty-state-action': [
    'The configured recovery action.',
    'After the user activates the empty-state action.',
    'Run the registered recovery path and update the surrounding data state.',
  ],
  'aeliqo-explorer-filter': [
    'The proposed validated predicate.',
    'After the explorer filter is applied.',
    'Evaluate the predicate in the host and replace rows/result evidence.',
  ],
  'aeliqo-explorer-selection': [
    'The selected stable identity key.',
    'After explorer selection changes.',
    'Load authorized detail evidence and update controlled selection.',
  ],
  'aeliqo-file-change': [
    '`{source, files}` with file metadata only.',
    'After the native picker selection changes.',
    'Validate metadata, obtain file content from the trusted host path, and own any upload.',
  ],
  'aeliqo-filter-change': [
    'The typed predicate and filter state.',
    'After Apply, or after a valid change when auto-apply is enabled.',
    'Validate and evaluate the predicate, then update rows and Result evidence.',
  ],
  'aeliqo-form-flow-commit': [
    'The current draft, validation evidence, and step context.',
    'After the user commits the final valid step.',
    'Authorize and execute the registered action; report pending, success, or failure.',
  ],
  'aeliqo-form-flow-step': [
    'The proposed next step ID and current draft.',
    'After Back or Next is activated.',
    'Validate the draft and update `activeStep` if the transition is accepted.',
  ],
  'aeliqo-form-reset': [
    'No detail payload.',
    'After the user requests a form reset.',
    'Restore the application-owned initial draft and validation state.',
  ],
  'aeliqo-form-submit': [
    '`{source, submitter}`',
    'After a valid native submit request.',
    'Authorize the command, execute it through the action boundary, and update pending state.',
  ],
  'aeliqo-input-change': [
    '`{source, value, composing?}`',
    'Whenever the user proposes a draft value change.',
    'Validate or store the draft and reassign controlled `value` or `checked` state.',
  ],
  'aeliqo-input-commit': [
    '`{source, value}`',
    'After explicit commit, blur, or Enter where the control supports it.',
    'Accept or reject the committed value and update authoritative form state.',
  ],
  'aeliqo-link': [
    '`{source, target, modified?}`',
    'Before component-managed navigation.',
    'Apply routing and authorization while preserving browser modifier behavior.',
  ],
  'aeliqo-menu-action': [
    'The selected enabled menu item ID.',
    'After Enter, Space, or pointer activation.',
    'Authorize the command, perform it, and close or update the menu.',
  ],
  'aeliqo-navigation': [
    'The approved destination and navigation context.',
    'After a navigation item is activated.',
    'Route through the application and preserve browser history semantics.',
  ],
  'aeliqo-page-change': [
    'The requested one-based page.',
    'After previous, next, or a page control is activated.',
    'Load the authorized page and update controlled `page` and content.',
  ],
  'aeliqo-popover-close': [
    'The close reason.',
    'After Escape or an allowed outside interaction.',
    'Set `open` to false and restore focus when appropriate.',
  ],
  'aeliqo-record-editor-cancel': [
    'The entity key, revision, and current draft context.',
    'After the user cancels editing.',
    'Keep or discard the draft by application policy and restore focus.',
  ],
  'aeliqo-record-editor-save': [
    'The entity key, revision, action reference, and validated draft.',
    'After the user requests save from a valid editor.',
    'Recheck revision and authority, execute the action, and report the outcome.',
  ],
  'aeliqo-record-list-selection': [
    'Stable selected identity keys plus result lineage.',
    'After record-list selection changes.',
    'Validate scope and update controlled `selectedKeys`.',
  ],
  'aeliqo-search': [
    '`{source, query}`',
    'After an explicit search commit or valid debounced input.',
    'Execute a bounded authorized search and update result revision and rows.',
  ],
  'aeliqo-search-results-selection': [
    'The selected stable result identity.',
    'After a search result is selected.',
    'Load authorized detail evidence and update `selectedKey`.',
  ],
  'aeliqo-selection-clear': [
    'The current selection scope and an empty proposed selection.',
    'After the clear-selection action.',
    'Clear application selection state without changing the underlying result.',
  ],
  'aeliqo-split-change': [
    '`{source, orientation, position}`',
    'While the user moves the separator.',
    'Clamp and persist the accepted position, then update controlled `position`.',
  ],
  'aeliqo-table-page': [
    'The requested page and page size.',
    'After table paging controls are activated.',
    'Fetch or select that page, then update rows, Result evidence, and `page`.',
  ],
  'aeliqo-table-selection': [
    'Stable selected identity keys plus result lineage.',
    'After table selection changes.',
    'Validate scope and update controlled `selectedKeys`.',
  ],
  'aeliqo-table-sort': [
    'The requested column and direction.',
    'After a sortable column header is activated.',
    'Apply sorting in the data owner, then update rows and controlled `sort`.',
  ],
  'aeliqo-table-window': [
    'The requested virtual start and count.',
    'When scrolling requires another virtual row window.',
    'Load the bounded window and update rows, `virtualStart`, and `virtualCount`.',
  ],
  'aeliqo-tabs-change': [
    'The proposed stable tab ID.',
    'After activation according to automatic or manual mode.',
    'Load any required panel data and update controlled `value`.',
  ],
  'aeliqo-toast-dismiss': [
    'The dismissal reason for the current toast.',
    'After timeout or user dismissal.',
    'Remove the toast from application state.',
  ],
  'aeliqo-tree-nav-expand': [
    'The node ID and proposed expanded state.',
    'After a branch toggle.',
    'Update controlled `expandedIds` while preserving valid selection.',
  ],
  'aeliqo-tree-nav-select': [
    'The selected enabled node ID.',
    'After keyboard or pointer selection.',
    'Route or update controlled `selectedId`.',
  ],
  'aeliqo-validation': [
    '`{source, state, message}`',
    'When validation enters pending, valid, or invalid state.',
    'Merge the result with application validation and display authoritative errors.',
  ],
  'aeliqo-visualization-select': [
    'Selected mark identity plus Result lineage.',
    'After a selectable mark is activated.',
    'Validate lineage and update controlled visualization or linked-detail selection.',
  ],
});

const EVENT_PATTERN_RULES = Object.freeze([
  [
    (name) => name.endsWith('-close') || name.endsWith('-dismiss'),
    (label) => [
      'The close or dismissal reason.',
      `After the user requests ${label}.`,
      'Update the controlled visible state and restore focus when appropriate.',
    ],
  ],
  [
    (name) => name.endsWith('-selection') || name.endsWith('-select'),
    (label) => [
      'The proposed stable selection identity.',
      `After ${label}.`,
      'Validate identity and scope, then update controlled selection state.',
    ],
  ],
]);

function defaultEventCopy(name) {
  const label = words(name.replace(/^aeliqo-/u, ''));
  const rule = EVENT_PATTERN_RULES.find(([predicate]) => predicate(name));
  if (rule) return rule[1](label);
  return [
    'The typed proposal declared by the component event class.',
    `After the user requests ${label}.`,
    'Validate the proposal, perform any authorized effect, and update controlled properties.',
  ];
}

export function documentedEvents(values) {
  const names = [...new Set(values.flatMap((value) => value.match(/aeliqo-[a-z0-9-]+/gu) ?? []))];
  return names.map((name) => ({ name, copy: EVENT_COPY[name] ?? defaultEventCopy(name) }));
}

export function listenerExample(component, event) {
  const tag = `aeliqo-${component.id.slice(component.id.indexOf('.') + 1)}`;
  return `const element = document.querySelector('${tag}');\n\nelement?.addEventListener('${event.name}', (event) => {\n  const proposal = (event as CustomEvent<unknown>).detail;\n  // Validate the proposal, update host state, then assign controlled properties.\n  applyProposal(proposal);\n});`;
}
