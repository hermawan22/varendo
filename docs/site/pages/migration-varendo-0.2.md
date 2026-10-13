---
id: 'migration-varendo-0-2'
path: '/ship/migration-varendo-0.2/'
section: 'Releases'
title: 'Migrate from 0.1 to 0.2'
description: 'Rename the remaining former Aeliqo identifiers, element tags, CSS custom properties, data attributes, events, storage keys and tool names to Varendo.'
---

<varendo-release-status></varendo-release-status>

## Migrate from 0.1 to 0.2

Varendo 0.2.0 is a breaking rename release. Varendo was formerly named Aeliqo, and 0.1.0 kept the former identifiers so that the package-scope move stayed small. In 0.2.0 every remaining `Aeliqo`, `aeliqo` and `AELIQO` identifier becomes `Varendo`, `varendo` and `VARENDO`. Behavior, data contracts and the serialized contract version `1` do not change; only names change. There are no compatibility aliases: the old names are removed, not deprecated.

Update all five packages together to **0.2.0** and check the [package publication status](/reference/packages/) before installing:

```sh
pnpm add @varendo/core@0.2.0 @varendo/runtime@0.2.0 @varendo/web@0.2.0 @varendo/react@0.2.0 @varendo/agent@0.2.0
```

Install only the packages your application uses. Upgrading from Aeliqo 0.7.1 also needs the package-scope change in the [Aeliqo to Varendo guide](/ship/migration-varendo/).

## Rename rules

Each name keeps its case style. Apply the rule to imports, JSX, HTML, CSS, selectors, tests and configuration. Package names and export subpaths such as `@varendo/web/table` do not change.

| Kind                          | 0.1.0                                      | 0.2.0                                        |
| ----------------------------- | ------------------------------------------ | -------------------------------------------- |
| Functions and hooks           | `createAeliqoApp`, `useAeliqoRuntime`      | `createVarendoApp`, `useVarendoRuntime`      |
| Classes, types and components | `AeliqoTableElement`, `AeliqoProvider`     | `VarendoTableElement`, `VarendoProvider`     |
| Constants                     | `AELIQO_PRESENTATION_MANIFESTS`            | `VARENDO_PRESENTATION_MANIFESTS`             |
| Custom element tags           | `<aeliqo-table>`, `<aeliqo-region>`        | `<varendo-table>`, `<varendo-region>`        |
| CSS custom properties         | `--aeliqo-*`                               | `--varendo-*`                                |
| Data attributes               | `data-aeliqo-*`                            | `data-varendo-*`                             |
| DOM events                    | `aeliqo-input-change`, `aeliqo-table-sort` | `varendo-input-change`, `varendo-table-sort` |
| MCP and WebMCP tools          | `aeliqo_context`, `aeliqo_render`          | `varendo_context`, `varendo_render`          |
| Environment variables (tools) | `AELIQO_*`                                 | `VARENDO_*`                                  |

## Common functions and components

| 0.1.0                         | 0.2.0                          |
| ----------------------------- | ------------------------------ |
| `createAeliqoApp`             | `createVarendoApp`             |
| `createAeliqoRuntime`         | `createVarendoRuntime`         |
| `registerAeliqoElements`      | `registerVarendoElements`      |
| `registerAeliqoReactElements` | `registerVarendoReactElements` |
| `renderAeliqo`                | `renderVarendo`                |
| `useAeliqoApp`                | `useVarendoApp`                |
| `useAeliqoRender`             | `useVarendoRender`             |
| `useAeliqoRuntime`            | `useVarendoRuntime`            |
| `useAeliqoScope`              | `useVarendoScope`              |
| `getAeliqoToken`              | `getVarendoToken`              |
| `AeliqoProvider`              | `VarendoProvider`              |
| `AeliqoRegion`                | `VarendoRegion`                |
| `AeliqoScope`                 | `VarendoScope`                 |
| `AeliqoRuntime`               | `VarendoRuntime`               |
| `AeliqoDataScope`             | `VarendoDataScope`             |
| `AeliqoFilterPredicate`       | `VarendoFilterPredicate`       |
| `AeliqoTextFieldElement`      | `VarendoTextFieldElement`      |
| `AeliqoInputChangeEvent`      | `VarendoInputChangeEvent`      |

Every component wrapper and element class follows the same rule, for example `AeliqoTable` → `VarendoTable` and `AeliqoChartElement` → `VarendoChartElement`. Generated declarations on each [component page](/components/) show the current names.

## Element tags, CSS variables and data attributes

| 0.1.0                                  | 0.2.0                                    |
| -------------------------------------- | ---------------------------------------- |
| `<aeliqo-region>`                      | `<varendo-region>`                       |
| `<aeliqo-table>`                       | `<varendo-table>`                        |
| `<aeliqo-chart>`                       | `<varendo-chart>`                        |
| `<aeliqo-text-field>`                  | `<varendo-text-field>`                   |
| `<aeliqo-button>` and every `aeliqo-*` | `<varendo-button>` and every `varendo-*` |
| `--aeliqo-color-*`, `--aeliqo-space-*` | `--varendo-color-*`, `--varendo-space-*` |
| `data-aeliqo-theme`                    | `data-varendo-theme`                     |
| `data-aeliqo-density`                  | `data-varendo-density`                   |
| `data-aeliqo-text-scale`               | `data-varendo-text-scale`                |
| `data-aeliqo-node-id`                  | `data-varendo-node-id`                   |
| `data-aeliqo-role`                     | `data-varendo-role`                      |
| `data-aeliqo-result`                   | `data-varendo-result`                    |

Rename theme overrides together with the tags they style. A stylesheet that still sets `--aeliqo-*` properties no longer affects Varendo elements, and a selector such as `aeliqo-table` or `[data-aeliqo-node-id]` no longer matches. Do not load 0.1.0 and 0.2.0 web packages in the same document.

## Events, tools and stored state

Listen for the `varendo-*` event names; event detail shapes are unchanged. Agent hosts and clients call the `varendo_context`, `varendo_render`, `varendo_act`, `varendo_surface_context` and `varendo_surface_render` tools. Update model instructions, allowlists and recorded transcripts that name the former tools.

Browser storage keys and diagnostic identifiers use the `varendo` prefix. State saved under a former `aeliqo` key is not read by 0.2.0. When it must survive the upgrade, copy it to the new key in host code before mounting Varendo; otherwise users start from the default state.

## Unchanged contracts

The rename does not alter runtime trust boundaries or lifecycle behavior. Resource `policy.expectedIssuer` and `issuer` checks still apply. `createAppToolSession` continues to target explicit application scopes. Host `onDraftExit` decisions can return `needs-input`; a committed plan is distinct from `renderer-ready`. Presentation callbacks (`onPresentation`), `stateMappings` and `context.incumbent` keep their existing validation.

## Rollback

Before upgrading, rollback means keeping the existing 0.1.0 lockfile and deployment. After an application switches, restore its 0.1.0 package versions, exact lockfile and former identifiers together, then rebuild and verify its persisted state. Never mix 0.1.0 and 0.2.0 packages in one application.
