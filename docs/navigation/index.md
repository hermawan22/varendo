# Navigation components

The navigation family is direct, host-controlled web UI. Each component emits a cancelable user event; a host may apply a route, selection, page request, or action after checking its own policy. Component events carry stable IDs and never contain arbitrary executable callbacks or model-selected URLs.

| Component | Main state | Keyboard and focus behavior |
| --- | --- | --- |
| `aeliqo-tabs` | `items`, `value`, `defaultValue`, `activation`, `orientation` | Arrow keys move between enabled tabs; automatic activation selects on movement, manual activation waits for Enter/Space. Panels use stable tab/panel IDs. |
| `aeliqo-breadcrumb` | `items`, `label` | The current item is text with `aria-current="page"`; only host-resolved safe links render as anchors. |
| `aeliqo-pagination` | `page`, `pageCount`, `hasPrevious`, `hasNext`, `pending` | Native buttons expose page scope and disable at known boundaries or while pending. |
| `aeliqo-menu` | `items`, `open`, `label` | Native trigger and menu buttons support Arrow/Home/End, Enter/Space, Escape, outside dismissal, and focus return. |
| `aeliqo-tree-nav` | `nodes`, `expandedIds`, `selectedId`, `label` | Stable node IDs support Arrow/Home/End navigation, expansion, selection, and disabled nodes. |

All components expose named `part` hooks and use the shared focus ring and target-size tokens. Route resolution remains application-owned. Resize, RTL, text scaling, and ordinary keyboard interaction do not invoke a model.
