# Synthetic HR oracle fixture

Eight synthetic employees, twelve calendar weeks, declared work schedules, attendance observations and approved leave. There are no real employee records or claims about actual workplace behavior.

`raw.json` is raw source data, not a precomputed absences endpoint. `expected.json` is an independent exact-fraction result for this explicit demonstration policy. This policy is not a universal HR rule.

The expected results use set-based schedule, leave, and absence counting. The TypeScript query tests verify the same rules and cover broader combinations with generated cases. Production code must treat this fixture as example data only.
