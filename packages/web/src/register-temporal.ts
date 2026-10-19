import {
  VarendoMatrixElement,
  VarendoTimelineElement,
  VarendoCalendarGridElement,
} from './visualization/temporal/index.js';
import type { ElementRegistration } from './register-elements.js';

export const registrations: readonly ElementRegistration[] = [
  { name: 'varendo-matrix', constructor: VarendoMatrixElement },
  { name: 'varendo-timeline', constructor: VarendoTimelineElement },
  { name: 'varendo-calendar-grid', constructor: VarendoCalendarGridElement },
];
