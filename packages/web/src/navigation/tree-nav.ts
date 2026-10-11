import { css, html, nothing } from 'lit';
import { AeliqoFoundationElement, aeliqoFoundationThemeStyles } from '../foundation/base.js';
import { aeliqoNavigationStyles, emitAction } from './shared.js';

export interface AeliqoTreeNavNode {
  readonly id: string;
  readonly label: string;
  readonly children?: readonly AeliqoTreeNavNode[];
  readonly disabled?: boolean;
}

interface FlatNode {
  readonly node: AeliqoTreeNavNode;
  readonly level: number;
  readonly parentId?: string;
}
const MAX_TREE_NODES = 512;

type RawTreeNode = {
  readonly id?: unknown;
  readonly label?: unknown;
  readonly children?: unknown;
  readonly disabled?: unknown;
};

type TreeFrame = { readonly nodes: readonly unknown[]; index: number; readonly owner?: object };

function rawTreeNode(value: unknown): RawTreeNode | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as RawTreeNode;
}

function nodeIdentityError(node: RawTreeNode, seenIds: Set<string>): string | undefined {
  if (typeof node.id !== 'string' || node.id.length === 0 || node.id.length > 160)
    return 'Tree node identities must be non-empty strings of at most 160 characters.';
  if (seenIds.has(node.id)) return 'Tree node identities must be unique.';
  return undefined;
}

function nodePropertiesError(node: RawTreeNode): string | undefined {
  if (typeof node.label !== 'string') return 'Tree node labels must be strings.';
  if (node.disabled !== undefined && typeof node.disabled !== 'boolean')
    return 'Tree node disabled state must be boolean.';
  if (node.children !== undefined && !Array.isArray(node.children)) return 'Tree node children must be arrays.';
  return undefined;
}

function nodeValidationError(value: unknown, seenIds: Set<string>, ancestors: Set<object>): string | undefined {
  const node = rawTreeNode(value);
  if (node === undefined) return 'The navigation tree contains an invalid node.';
  if (ancestors.has(node)) return 'The navigation tree contains a cycle.';
  return nodeIdentityError(node, seenIds) ?? nodePropertiesError(node);
}

function closeTreeFrame(frame: TreeFrame, ancestors: Set<object>): void {
  if (frame.owner !== undefined) ancestors.delete(frame.owner);
}

function focusIndexForKey(key: string, index: number, lastIndex: number): number | undefined {
  switch (key) {
    case 'ArrowDown':
      return Math.min(lastIndex, index + 1);
    case 'ArrowUp':
      return Math.max(0, index - 1);
    case 'Home':
      return 0;
    case 'End':
      return lastIndex;
    default:
      return undefined;
  }
}

function focusTargetId(visible: readonly FlatNode[], selectedId: string, focusedId: string): string {
  const visibleIds = new Set(visible.map((flat) => flat.node.id));
  if (visibleIds.has(selectedId)) return selectedId;
  if (visibleIds.has(focusedId)) return focusedId;
  return visible[0]?.node.id ?? '';
}

export class AeliqoTreeNavElement extends AeliqoFoundationElement {
  static readonly properties = {
    nodes: { attribute: false },
    expandedIds: { attribute: false },
    selectedId: { type: String },
    label: { type: String },
  };
  static readonly styles = [
    ...aeliqoFoundationThemeStyles,
    aeliqoNavigationStyles,
    css`
      [part='tree'] {
        list-style: none;
        margin: 0;
        padding: var(--aeliqo-space-4, 0.25rem);
      }
      [role='treeitem'] {
        align-items: center;
        border-radius: var(--aeliqo-radius-small, 0.375rem);
        cursor: pointer;
        display: flex;
        gap: var(--aeliqo-space-8, 0.5rem);
        min-block-size: var(--aeliqo-control-min-target, 2.75rem);
        padding-block: var(--aeliqo-space-4, 0.25rem);
        padding-inline: var(--aeliqo-space-8, 0.5rem);
      }
      [role='treeitem'][aria-selected='true'] {
        background: color-mix(in srgb, var(--aeliqo-color-accent, #4338ca) 14%, transparent);
        font-weight: var(--aeliqo-typography-font-weight-semibold, 600);
      }
      [role='treeitem'][aria-disabled='true'] {
        cursor: not-allowed;
        opacity: 0.55;
      }
      [role='group'] {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .chevron {
        align-items: center;
        display: inline-flex;
        inline-size: 2rem;
        justify-content: center;
      }
      [part='toggle'] {
        background: transparent;
        border: 0;
        color: inherit;
        cursor: pointer;
        display: inline-grid;
        font: inherit;
        min-block-size: var(--aeliqo-control-min-target, 2.75rem);
        min-inline-size: var(--aeliqo-control-min-target, 2.75rem);
        padding: 0;
        place-items: center;
      }
    `,
  ];

  nodes: readonly AeliqoTreeNavNode[] = [];
  expandedIds: readonly string[] = [];
  selectedId = '';
  label = 'Navigation tree';
  private internalExpanded = new Set<string>();
  private focusedId = '';
  private treeError = '';

  protected override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('expandedIds')) this.internalExpanded = new Set(this.expandedIds);
    if (changed.has('nodes')) this.treeError = this.validateNodes() ?? '';
  }
  private isExpanded(id: string): boolean {
    return this.internalExpanded.has(id);
  }
  private validateNodes(): string | undefined {
    try {
      if (!Array.isArray(this.nodes)) return 'The navigation tree data is invalid.';
      const seenIds = new Set<string>();
      const ancestors = new Set<object>();
      const stack: TreeFrame[] = [{ nodes: this.nodes as readonly unknown[], index: 0 }];
      let count = 0;
      while (stack.length > 0) {
        const frame = stack[stack.length - 1]!;
        if (frame.index >= frame.nodes.length) {
          closeTreeFrame(frame, ancestors);
          stack.pop();
          continue;
        }
        const value = frame.nodes[frame.index++];
        if (++count > MAX_TREE_NODES) return `The navigation tree exceeds ${MAX_TREE_NODES} nodes.`;
        const error = nodeValidationError(value, seenIds, ancestors);
        if (error !== undefined) return error;
        const node = value as RawTreeNode;
        const id = node.id as string;
        seenIds.add(id);
        if (node.children === undefined) continue;
        ancestors.add(value as object);
        stack.push({ nodes: node.children as readonly unknown[], index: 0, owner: value as object });
      }
    } catch {
      return 'The navigation tree data is invalid.';
    }
    return undefined;
  }
  private flatVisible(): FlatNode[] {
    if (this.treeError) return [];
    const result: FlatNode[] = [];
    const seenIds = new Set<string>();
    const visit = (nodes: readonly AeliqoTreeNavNode[], level: number, parentId?: string): void => {
      for (const node of nodes) {
        if (result.length >= MAX_TREE_NODES || seenIds.has(node.id)) return;
        seenIds.add(node.id);
        result.push({ node, level, ...(parentId === undefined ? {} : { parentId }) });
        if (node.children?.length && this.isExpanded(node.id)) visit(node.children, level + 1, node.id);
      }
    };
    visit(this.nodes, 1);
    return result;
  }
  private select(node: AeliqoTreeNavNode): void {
    if (node.disabled) return;
    if (!emitAction(this, 'aeliqo-tree-nav-select', { id: node.id, previousId: this.selectedId })) return;
    this.focusedId = node.id;
    this.selectedId = node.id;
  }
  private toggle(node: AeliqoTreeNavNode): void {
    if (node.disabled) return;
    const expanded = this.isExpanded(node.id);
    if (!emitAction(this, 'aeliqo-tree-nav-expand', { id: node.id, expanded: !expanded })) return;
    if (expanded) this.internalExpanded.delete(node.id);
    else this.internalExpanded.add(node.id);
    this.focusedId = node.id;
    this.renderRoot.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(node.id)}"]`)?.focus();
    this.requestUpdate();
  }
  private toggleFromPointer(event: Event, node: AeliqoTreeNavNode): void {
    event.stopPropagation();
    this.toggle(node);
  }
  private focusNode(node: AeliqoTreeNavNode): void {
    this.focusedId = node.id;
  }
  private keydown(event: KeyboardEvent, flat: FlatNode, index: number): void {
    if (event.target instanceof HTMLButtonElement) return;
    const node = flat.node;
    switch (event.key) {
      case 'ArrowRight':
        return this.handleArrowRight(event, node);
      case 'ArrowLeft':
        return this.handleArrowLeft(event, flat.parentId, node);
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Home':
      case 'End': {
        const next = focusIndexForKey(event.key, index, this.flatVisible().length - 1);
        if (next !== undefined) this.focusVisibleIndex(event, next);
        return;
      }
      case 'Enter':
      case ' ':
        this.selectFromKeyboard(event, node);
    }
  }

  private handleArrowRight(event: KeyboardEvent, node: AeliqoTreeNavNode): void {
    event.preventDefault();
    if (!node.children?.length) return;
    if (!this.isExpanded(node.id)) return this.toggle(node);
    this.focusTreeNode(node.children[0]!.id);
  }

  private handleArrowLeft(event: KeyboardEvent, parentId: string | undefined, node: AeliqoTreeNavNode): void {
    event.preventDefault();
    if (node.children?.length && this.isExpanded(node.id)) return this.toggle(node);
    if (parentId !== undefined) this.focusTreeNode(parentId);
  }

  private focusVisibleIndex(event: KeyboardEvent, index: number): void {
    event.preventDefault();
    const visible = this.flatVisible();
    const target = visible[index];
    if (target !== undefined) this.focusTreeNode(target.node.id);
  }

  private selectFromKeyboard(event: KeyboardEvent, node: AeliqoTreeNavNode): void {
    event.preventDefault();
    this.select(node);
  }

  private focusTreeNode(id: string): void {
    this.focusedId = id;
    this.renderRoot.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`)?.focus();
  }

  private expandedAttribute(node: AeliqoTreeNavNode, hasChildren: boolean) {
    if (!hasChildren) return nothing;
    return this.isExpanded(node.id) ? 'true' : 'false';
  }

  private renderNode(flat: FlatNode, focusId: string) {
    const node = flat.node;
    const hasChildren = Boolean(node.children?.length);
    return html`<li
      role="treeitem"
      part="item"
      data-tree-id=${node.id}
      aria-level=${flat.level}
      aria-selected=${node.id === this.selectedId ? 'true' : 'false'}
      aria-expanded=${this.expandedAttribute(node, hasChildren)}
      aria-disabled=${node.disabled ? 'true' : nothing}
      tabindex=${node.id === focusId ? '0' : '-1'}
      style=${`padding-inline-start: calc(var(--aeliqo-space-8, 0.5rem) + ${(flat.level - 1) * 1.25}rem)`}
      @focus=${() => this.focusNode(node)}
      @click=${() => this.select(node)}
      @keydown=${(event: KeyboardEvent) =>
        this.keydown(
          event,
          flat,
          this.flatVisible().findIndex((item) => item.node.id === node.id),
        )}
    >
      ${hasChildren ? html`<button part="toggle" class="chevron" type="button" tabindex="-1" ?disabled=${node.disabled} aria-label=${this.isExpanded(node.id) ? 'Collapse' : 'Expand'} aria-expanded=${this.isExpanded(node.id) ? 'true' : 'false'} @click=${(event: Event) => this.toggleFromPointer(event, node)} @keydown=${(event: KeyboardEvent) => event.stopPropagation()}>${this.isExpanded(node.id) ? '⌄' : '›'}</button>` : html`<span class="chevron" aria-hidden="true"></span>`}<span
        >${node.label}</span
      >
    </li>`;
  }
  protected override render() {
    if (this.treeError) return html`<nav aria-label=${this.label}><p role="status">${this.treeError}</p></nav>`;
    const visible = this.flatVisible();
    const focusId = focusTargetId(visible, this.selectedId, this.focusedId);
    return html`<nav aria-label=${this.label}>
      <ul part="tree" role="tree">
        ${visible.map((flat) => this.renderNode(flat, focusId))}
      </ul>
    </nav>`;
  }
}
