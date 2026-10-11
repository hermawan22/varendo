type Person = Readonly<{ id: string; name: string; team: string; location: string }>;

const people: readonly Person[] = Object.freeze([
  { id: 'p-1', name: 'Ada Chen', team: 'Design', location: 'Jakarta' },
  { id: 'p-2', name: 'Sam Rivera', team: 'Engineering', location: 'Lisbon' },
  { id: 'p-3', name: 'Iman Putra', team: 'Engineering', location: 'Bandung' },
  { id: 'p-4', name: 'Lee Morgan', team: 'Operations', location: 'London' },
]);

const rows = document.querySelector<HTMLTableSectionElement>('#people-rows')!;
const filter = document.querySelector<HTMLElement>('#people-filter')!;

function showPeople(selected: readonly Person[], location?: string): void {
  const identifiers = new Set<string>();
  const rendered = selected.map((person) => {
    if (identifiers.has(person.id)) throw new Error('Duplicate person identity.');
    identifiers.add(person.id);
    const row = document.createElement('tr');
    for (const field of [person.name, person.team, person.location]) {
      const cell = document.createElement('td');
      cell.textContent = field;
      row.append(cell);
    }
    return row;
  });
  rows.replaceChildren(...rendered);
  filter.textContent =
    location === undefined
      ? 'All authorized people · scope vnext-scope'
      : `People with location ${location} · scope vnext-scope`;
}

document.querySelector<HTMLButtonElement>('#show-jakarta')!.addEventListener('click', () => {
  showPeople(
    people.filter((person) => person.location === 'Jakarta'),
    'Jakarta',
  );
});
showPeople(people);
