import {
  AeliqoMatrixElement,
  AeliqoTimelineElement,
  AeliqoCalendarGridElement,
} from './visualization/temporal/index.js';
import type { ElementRegistration } from './register-elements.js';

export const registrations: readonly ElementRegistration[] = [
  { name: 'aeliqo-matrix', constructor: AeliqoMatrixElement },
  { name: 'aeliqo-timeline', constructor: AeliqoTimelineElement },
  { name: 'aeliqo-calendar-grid', constructor: AeliqoCalendarGridElement },
];
