import type { Outcome } from '@varendo/core';
import type { PresentationNode, PresentationValues } from '@varendo/core/presentation';
import type {
  AeliqoFeedbackBinding,
  AeliqoNavigationFeedbackAction,
  AeliqoNavigationFeedbackBindings,
  AeliqoNavigationFeedbackContent,
} from './navigation-feedback-types.js';
import { AELIQO_NAVIGATION_FEEDBACK_REFS } from './navigation-feedback-contracts.js';
import { EMPTY_STATE_KINDS, FEEDBACK_TONES, SKELETON_VARIANTS, fail } from './navigation-feedback-support.js';
import {
  actionValue,
  baseValues,
  content,
  navPort,
  resolved,
  type ResolvedPresentation,
} from './navigation-feedback-config-common.js';
import { feedbackBase } from './navigation-feedback-config-navigation.js';

type FeedbackKind = keyof typeof AELIQO_NAVIGATION_FEEDBACK_REFS;
type FeedbackContext = {
  readonly input: Record<string, unknown>;
  readonly entry: AeliqoFeedbackBinding;
  readonly contents: Map<string, AeliqoNavigationFeedbackContent>;
  readonly actions: Map<string, AeliqoNavigationFeedbackAction>;
};

export function feedbackConfig(
  values: PresentationValues,
  kind: FeedbackKind,
  bindings: AeliqoNavigationFeedbackBindings,
  node?: PresentationNode,
): Outcome<ResolvedPresentation> {
  switch (kind) {
    case 'tooltip':
      return tooltipConfig(values, bindings);
    case 'popover':
      return popoverConfig(values, bindings);
    case 'dialog':
      return dialogConfig(values, bindings, node);
    case 'drawer':
      return drawerConfig(values, bindings, node);
    case 'toast':
      return toastConfig(values, bindings);
    case 'alert':
      return alertConfig(values, bindings);
    case 'progress':
      return progressConfig(values, bindings);
    case 'skeleton':
      return skeletonConfig(values, bindings);
    case 'emptyState':
      return emptyStateConfig(values, bindings);
    default:
      return fail(
        'config',
        `Unsupported feedback manifest ${String(AELIQO_NAVIGATION_FEEDBACK_REFS[kind]?.id ?? kind)}.`,
      );
  }
}

function tooltipConfig(
  values: PresentationValues,
  bindings: AeliqoNavigationFeedbackBindings,
): Outcome<ResolvedPresentation> {
  const checked = feedbackBase(values, ['bindingRevision', 'bindingRef', 'open'], bindings);
  if (!checked.ok) return checked;
  const label = content(checked.value.contents, checked.value.entry.labelRef, 'tooltip label');
  if (!label.ok) return label;
  const body = content(checked.value.contents, checked.value.entry.contentRef, 'tooltip content');
  if (!body.ok) return body;
  if (!optionalBoolean(checked.value.input.open)) return fail('config', 'Tooltip open must be boolean.');
  const open = booleanValue(checked.value.input, 'open', false);
  return resolved({
    ...baseValues(bindings, checked.value.entry.id),
    label: label.value!,
    content: body.value!,
    open,
  });
}

function popoverConfig(
  values: PresentationValues,
  bindings: AeliqoNavigationFeedbackBindings,
): Outcome<ResolvedPresentation> {
  const checked = feedbackBase(values, ['bindingRevision', 'bindingRef', 'open', 'modal', 'closeOnOutside'], bindings);
  if (!checked.ok) return checked;
  const label = content(checked.value.contents, checked.value.entry.labelRef, 'popover label');
  if (!label.ok) return label;
  const body = content(checked.value.contents, checked.value.entry.contentRef, 'popover content');
  if (!body.ok) return body;
  const invalidBoolean = booleanConfigError(checked.value.input, ['open', 'modal', 'closeOnOutside'], 'Popover');
  if (invalidBoolean !== undefined) return fail('config', invalidBoolean);
  return resolved({
    ...baseValues(bindings, checked.value.entry.id),
    label: label.value!,
    content: body.value!,
    open: booleanValue(checked.value.input, 'open', false),
    modal: booleanValue(checked.value.input, 'modal', false),
    closeOnOutside: booleanValue(checked.value.input, 'closeOnOutside', true),
  });
}

function dialogConfig(
  values: PresentationValues,
  bindings: AeliqoNavigationFeedbackBindings,
  node?: PresentationNode,
): Outcome<ResolvedPresentation> {
  const checked = feedbackBase(values, ['bindingRevision', 'bindingRef', 'open', 'modal', 'closeOnEscape'], bindings);
  if (!checked.ok) return checked;
  const heading = content(checked.value.contents, checked.value.entry.headingRef, 'dialog heading');
  if (!heading.ok) return heading;
  const invalidBoolean = booleanConfigError(checked.value.input, ['open', 'modal', 'closeOnEscape'], 'Dialog');
  if (invalidBoolean !== undefined) return fail('config', invalidBoolean);
  const open = booleanValue(checked.value.input, 'open', false);
  if (hasChildrenWhenClosed(node, open))
    return fail('children', 'A closed dialog cannot claim child content before its host opens it.');
  return resolved({
    ...baseValues(bindings, checked.value.entry.id),
    heading: heading.value!,
    open,
    modal: booleanValue(checked.value.input, 'modal', true),
    closeOnEscape: booleanValue(checked.value.input, 'closeOnEscape', true),
  });
}

function drawerConfig(
  values: PresentationValues,
  bindings: AeliqoNavigationFeedbackBindings,
  node?: PresentationNode,
): Outcome<ResolvedPresentation> {
  const checked = feedbackBase(values, ['bindingRevision', 'bindingRef', 'open', 'mode', 'side'], bindings);
  if (!checked.ok) return checked;
  const heading = content(checked.value.contents, checked.value.entry.headingRef, 'drawer heading');
  if (!heading.ok) return heading;
  if (!optionalBoolean(checked.value.input.open)) return fail('config', 'Drawer open must be boolean.');
  if (!drawerMode(checked.value.input.mode)) return fail('config', 'Drawer mode must be inline or modal.');
  if (!drawerSide(checked.value.input.side)) return fail('config', 'Drawer side must be start or end.');
  const open = booleanValue(checked.value.input, 'open', false);
  if (hasChildrenWhenClosed(node, open))
    return fail('children', 'A closed drawer cannot claim child content before its host opens it.');
  return resolved({
    ...baseValues(bindings, checked.value.entry.id),
    heading: heading.value!,
    open,
    mode: checked.value.input.mode ?? 'inline',
    side: checked.value.input.side ?? 'end',
  });
}

function toastConfig(
  values: PresentationValues,
  bindings: AeliqoNavigationFeedbackBindings,
): Outcome<ResolvedPresentation> {
  const checked = feedbackBase(
    values,
    ['bindingRevision', 'bindingRef', 'open', 'tone', 'duration', 'dismissible'],
    bindings,
  );
  if (!checked.ok) return checked;
  const message = content(checked.value.contents, checked.value.entry.messageRef, 'toast message');
  if (!message.ok) return message;
  const configError = toastConfigError(checked.value.input);
  if (configError !== undefined) return fail('config', configError);
  return resolved({
    ...baseValues(bindings, checked.value.entry.id),
    message: message.value!,
    open: booleanValue(checked.value.input, 'open', false),
    tone: checked.value.input.tone ?? 'info',
    duration: checked.value.input.duration ?? 5_000,
    dismissible: booleanValue(checked.value.input, 'dismissible', true),
  });
}

function toastConfigError(input: Record<string, unknown>): string | undefined {
  if (!optionalBoolean(input.open)) return 'Toast open must be boolean.';
  if (input.tone !== undefined && !validTone(input.tone)) return 'Toast tone is unsupported.';
  if (input.duration !== undefined && !validDuration(input.duration))
    return 'Toast duration must be a bounded nonnegative integer.';
  if (!optionalBoolean(input.dismissible)) return 'Toast dismissible must be boolean.';
  return undefined;
}

function alertConfig(
  values: PresentationValues,
  bindings: AeliqoNavigationFeedbackBindings,
): Outcome<ResolvedPresentation> {
  const checked = feedbackBase(values, ['bindingRevision', 'bindingRef', 'open', 'tone', 'dismissible'], bindings);
  if (!checked.ok) return checked;
  const texts = alertContent(checked.value);
  if (!texts.ok) return texts;
  const configError = alertConfigError(checked.value.input, checked.value.entry);
  if (configError !== undefined) return fail('config', configError);
  const action = resolveFeedbackAction(checked.value, 'Alert');
  if (!action.ok) return action;
  const open = booleanValue(checked.value.input, 'open', true);
  const reachable = action.value !== undefined && open;
  return resolved(
    alertValues(bindings, checked.value.entry, checked.value.input, texts.value, action.value, open, reachable),
    [],
    actionPorts(reachable),
    actionOperations(action.value, reachable),
  );
}

function alertValues(
  bindings: AeliqoNavigationFeedbackBindings,
  entry: AeliqoFeedbackBinding,
  input: Record<string, unknown>,
  texts: { readonly heading?: string; readonly message: string; readonly actionLabel?: string },
  action: AeliqoNavigationFeedbackAction | undefined,
  open: boolean,
  reachable: boolean,
): Record<string, unknown> {
  return {
    ...baseValues(bindings, entry.id),
    ...(texts.heading === undefined ? {} : { heading: texts.heading }),
    message: texts.message,
    ...(texts.actionLabel === undefined || !reachable ? {} : { actionLabel: texts.actionLabel }),
    ...(reachable && action !== undefined ? actionValue(action) : {}),
    open,
    tone: input.tone ?? 'info',
    dismissible: booleanValue(input, 'dismissible', false),
  };
}

function alertContent(context: FeedbackContext): Outcome<{
  readonly heading?: string;
  readonly message: string;
  readonly actionLabel?: string;
}> {
  const heading = content(context.contents, context.entry.headingRef, 'alert heading', false);
  if (!heading.ok) return heading;
  const message = content(context.contents, context.entry.messageRef, 'alert message');
  if (!message.ok) return message;
  const actionLabel = content(context.contents, context.entry.actionLabelRef, 'alert action label', false);
  if (!actionLabel.ok) return actionLabel;
  return {
    ok: true,
    value: {
      ...(heading.value === undefined ? {} : { heading: heading.value }),
      message: message.value!,
      ...(actionLabel.value === undefined ? {} : { actionLabel: actionLabel.value }),
    },
  };
}

function alertConfigError(input: Record<string, unknown>, entry: AeliqoFeedbackBinding): string | undefined {
  if (entry.actionLabelRef !== undefined && entry.actionRef === undefined)
    return 'An alert action label requires a registered action.';
  if (entry.actionRef !== undefined && entry.actionLabelRef === undefined)
    return 'An alert action requires a host action label.';
  if (!optionalBoolean(input.open)) return 'Alert open must be boolean.';
  if (input.tone !== undefined && !validTone(input.tone)) return 'Alert tone is unsupported.';
  if (!optionalBoolean(input.dismissible)) return 'Alert dismissible must be boolean.';
  return undefined;
}

function resolveFeedbackAction(
  context: FeedbackContext,
  label: string,
): Outcome<AeliqoNavigationFeedbackAction | undefined> {
  if (context.entry.actionRef === undefined) return { ok: true, value: undefined };
  const action = context.actions.get(context.entry.actionRef);
  if (action === undefined) return fail('binding', `${label} actionRef is not registered.`);
  return { ok: true, value: action };
}

function actionPorts(reachable: boolean) {
  return reachable ? [navPort('action', 'action-request')] : [];
}

function actionOperations(action: AeliqoNavigationFeedbackAction | undefined, reachable: boolean) {
  return reachable && action !== undefined ? [action.action] : [];
}

function progressConfig(
  values: PresentationValues,
  bindings: AeliqoNavigationFeedbackBindings,
): Outcome<ResolvedPresentation> {
  const checked = feedbackBase(values, ['bindingRevision', 'bindingRef'], bindings);
  if (!checked.ok) return checked;
  const label = content(checked.value.contents, checked.value.entry.labelRef, 'progress label');
  if (!label.ok) return label;
  return resolved({
    ...baseValues(bindings, checked.value.entry.id),
    label: label.value!,
    ...(checked.value.entry.progressValue === undefined ? {} : { progressValue: checked.value.entry.progressValue }),
    ...(checked.value.entry.progressMax === undefined ? {} : { progressMax: checked.value.entry.progressMax }),
  });
}

function skeletonConfig(
  values: PresentationValues,
  bindings: AeliqoNavigationFeedbackBindings,
): Outcome<ResolvedPresentation> {
  const checked = feedbackBase(values, ['bindingRevision', 'bindingRef', 'lines', 'variant', 'animated'], bindings);
  if (!checked.ok) return checked;
  const label = content(checked.value.contents, checked.value.entry.labelRef, 'skeleton label');
  if (!label.ok) return label;
  const configError = skeletonConfigError(checked.value.input);
  if (configError !== undefined) return fail('config', configError);
  return resolved({
    ...baseValues(bindings, checked.value.entry.id),
    label: label.value!,
    lines: (checked.value.input.lines as number | undefined) ?? 3,
    variant: (checked.value.input.variant as string | undefined) ?? 'text',
    animated: (checked.value.input.animated as boolean | undefined) ?? true,
  });
}

function skeletonConfigError(input: Record<string, unknown>): string | undefined {
  if (input.lines !== undefined && !validSkeletonLines(input.lines))
    return 'Skeleton lines must be between one and twelve.';
  if (input.variant !== undefined && !SKELETON_VARIANTS.includes(input.variant as string))
    return 'Skeleton variant is unsupported.';
  if (!optionalBoolean(input.animated)) return 'Skeleton animated must be boolean.';
  return undefined;
}

function emptyStateConfig(
  values: PresentationValues,
  bindings: AeliqoNavigationFeedbackBindings,
): Outcome<ResolvedPresentation> {
  const checked = feedbackBase(values, ['bindingRevision', 'bindingRef'], bindings);
  if (!checked.ok) return checked;
  const texts = emptyStateContent(checked.value);
  if (!texts.ok) return texts;
  const bindingError = emptyStateBindingError(checked.value.entry);
  if (bindingError !== undefined) return fail('binding', bindingError);
  const action = resolveFeedbackAction(checked.value, 'Empty-state');
  if (!action.ok) return action;
  return resolved(
    emptyStateValues(bindings, checked.value.entry, texts.value, action.value),
    [],
    actionPorts(action.value !== undefined),
    actionOperations(action.value, action.value !== undefined),
  );
}

function emptyStateBindingError(entry: AeliqoFeedbackBinding): string | undefined {
  if (entry.actionLabelRef !== undefined && entry.actionRef === undefined)
    return 'An empty-state action label requires a registered action.';
  if (entry.actionRef !== undefined && entry.actionLabelRef === undefined)
    return 'An empty-state action requires a host action label.';
  if (entry.kind === undefined || !EMPTY_STATE_KINDS.includes(entry.kind))
    return 'Empty-state bindings require a truthful kind.';
  return undefined;
}

function emptyStateValues(
  bindings: AeliqoNavigationFeedbackBindings,
  entry: AeliqoFeedbackBinding,
  texts: { readonly heading: string; readonly message: string; readonly actionLabel?: string },
  action: AeliqoNavigationFeedbackAction | undefined,
): Record<string, unknown> {
  return {
    ...baseValues(bindings, entry.id),
    kind: entry.kind,
    heading: texts.heading,
    message: texts.message,
    ...(texts.actionLabel === undefined ? {} : { actionLabel: texts.actionLabel }),
    ...(action === undefined ? {} : actionValue(action)),
  };
}

function emptyStateContent(
  context: FeedbackContext,
): Outcome<{ readonly heading: string; readonly message: string; readonly actionLabel?: string }> {
  const heading = content(context.contents, context.entry.headingRef, 'empty-state heading');
  if (!heading.ok) return heading;
  const message = content(context.contents, context.entry.messageRef, 'empty-state message');
  if (!message.ok) return message;
  const actionLabel = content(context.contents, context.entry.actionLabelRef, 'empty-state action label', false);
  if (!actionLabel.ok) return actionLabel;
  return {
    ok: true,
    value: {
      heading: heading.value!,
      message: message.value!,
      ...(actionLabel.value === undefined ? {} : { actionLabel: actionLabel.value }),
    },
  };
}

function booleanConfigError(input: Record<string, unknown>, keys: readonly string[], name: string): string | undefined {
  for (const key of keys) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') return `${name} ${key} must be boolean.`;
  }
  return undefined;
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function booleanValue(input: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = input[key];
  return typeof value === 'boolean' ? value : fallback;
}

function hasChildrenWhenClosed(node: PresentationNode | undefined, open: boolean): boolean {
  return node !== undefined && node.children.length > 0 && !open;
}

function drawerMode(value: unknown): boolean {
  return value === undefined || value === 'inline' || value === 'modal';
}

function drawerSide(value: unknown): boolean {
  return value === undefined || value === 'start' || value === 'end';
}

function validTone(value: unknown): boolean {
  return typeof value === 'string' && FEEDBACK_TONES.includes(value as (typeof FEEDBACK_TONES)[number]);
}

function validDuration(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 60_000;
}

function validSkeletonLines(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 12;
}
