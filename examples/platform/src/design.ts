import './csp-bootstrap.js';
import { registerAeliqoElements } from '@varendo/web';
import { AeliqoInputChangeEvent, type AeliqoTextFieldElement } from '@varendo/web/inputs';
import type { AeliqoTableElement } from '@varendo/web/data';
import type { AeliqoChartElement } from '@varendo/web/chart';
import { aeliqoStandaloneThemeStyles, aeliqoLocaleAttributes, createAeliqoLocaleContext } from '@varendo/web/styles';

const stylesheet = document.createElement('style');
stylesheet.nonce = 't02nonce';
stylesheet.textContent = aeliqoStandaloneThemeStyles.cssText;
document.head.append(stylesheet);
registerAeliqoElements();
const root = document.querySelector<HTMLElement>('#design-root')!;
const team = document.querySelector<AeliqoTextFieldElement>('#team')!;
const people = document.querySelector<AeliqoTableElement>('#people')!;
const empty = document.querySelector<AeliqoTableElement>('#empty')!;
const activity = document.querySelector<AeliqoChartElement>('#activity')!;
const locale = document.querySelector<HTMLSelectElement>('#locale')!;
document.querySelector<HTMLSelectElement>('#theme')!.addEventListener('change', (event) => {
  root.dataset.aeliqoTheme = (event.currentTarget as HTMLSelectElement).value;
});
team.addEventListener('aeliqo-input-change', (event) => {
  if (!(event instanceof AeliqoInputChangeEvent)) return;
  team.value = event.detail.value;
  document.querySelector('#draft-status')!.textContent = `Draft: ${event.detail.value}`;
});
document.querySelector('form')!.addEventListener('submit', (event) => event.preventDefault());

const localeCopy = {
  en: {
    pageTitle: 'Team overview',
    intro: 'A small working view of people and their weekly activity.',
    detailsTitle: 'Team details',
    peopleTitle: 'People',
    activityTitle: 'Weekly activity',
    emptyTitle: 'Upcoming assignments',
    teamLabel: 'Team name',
    teamDescription: 'Changes stay in this local fixture.',
    columns: ['Name', 'Role', 'Location'],
    roles: ['Engineer', 'Researcher', 'Analyst'],
    emptyLabel: 'No upcoming assignments.',
    chartTitle: 'Activity across five days',
    chartSummary: 'Illustrative values only.',
  },
  ar: {
    pageTitle: 'نظرة عامة على الفريق',
    intro: 'بيانات تجريبية لعرض أعضاء الفريق ونشاطهم الأسبوعي.',
    detailsTitle: 'تفاصيل الفريق',
    peopleTitle: 'أعضاء الفريق',
    activityTitle: 'النشاط الأسبوعي',
    emptyTitle: 'المهام القادمة',
    teamLabel: 'الاسم الكامل للفريق المسؤول عن البحث والتطوير',
    teamDescription: 'تبقى التغييرات محلية في هذا المثال التجريبي.',
    columns: ['الاسم', 'الدور', 'الموقع'],
    roles: ['مهندسة', 'باحثة', 'محللة'],
    emptyLabel: 'لا توجد مهام قادمة.',
    chartTitle: 'النشاط خلال خمسة أيام',
    chartSummary: 'قيم تجريبية فقط.',
  },
} as const;

function renderLocale() {
  const attributes = aeliqoLocaleAttributes(createAeliqoLocaleContext(locale.value));
  for (const [name, value] of Object.entries(attributes)) root.setAttribute(name, value);
  const copy = attributes.dir === 'rtl' ? localeCopy.ar : localeCopy.en;
  document.querySelector('#page-title')!.textContent = copy.pageTitle;
  document.querySelector('#intro')!.textContent = copy.intro;
  document.querySelector('#details-title')!.textContent = copy.detailsTitle;
  document.querySelector('#people-title')!.textContent = copy.peopleTitle;
  document.querySelector('#activity-title')!.textContent = copy.activityTitle;
  document.querySelector('#empty-title')!.textContent = copy.emptyTitle;
  team.label = copy.teamLabel;
  team.description = copy.teamDescription;
  people.columns = [
    { key: 'name', label: copy.columns[0] },
    { key: 'role', label: copy.columns[1] },
    { key: 'location', label: copy.columns[2] },
  ];
  people.rows = [
    { name: 'Ada', role: copy.roles[0], location: 'Jakarta' },
    { name: 'Grace', role: copy.roles[1], location: 'London' },
    { name: 'Katherine', role: copy.roles[2], location: 'New York' },
  ];
  empty.columns = people.columns;
  empty.emptyLabel = copy.emptyLabel;
  activity.title = copy.chartTitle;
  activity.summary = copy.chartSummary;
  activity.unit = 'events';
  activity.scope = 'Synthetic fixture · one week';
  activity.points = [
    { label: 'Mon', value: 3 },
    { label: 'Tue', value: 5 },
    { label: 'Wed', value: 4 },
    { label: 'Thu', value: 7 },
    { label: 'Fri', value: 6 },
  ];
}
locale.addEventListener('change', renderLocale);
renderLocale();
