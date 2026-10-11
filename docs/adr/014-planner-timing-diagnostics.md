# ADR 014: Presentation-planner timing is diagnostic

Status: accepted by the owner on 1 October 2026.

## Context

The performance fixture records composition elapsed time after repeatedly
generating a large dataset and mounting its views. Source-identical comparisons
showed variable garbage-collection pauses during composition. These timings
remain useful observations, but the owner explicitly withdrew the absolute
presentation-planner latency acceptance rule.

## Decision

Remove the planner latency budget from configuration, policy validation, browser
assertions, paired-report acceptance, and current contributor guidance.
Presentation-planner timings are diagnostic only: they cannot determine whether
tests, CI, merges, publication, or deployment pass. Do not replace the removed
budget with another absolute planner latency threshold.

Retain every raw timing observation and trace and report planner p95 as a
measurement, without a within-budget flag. Keep the existing fixture and sample
counts; this decision does not change the measured scenario or assert a speedup.

The reducer, mounted-row, relative layout/visualization, source-provenance,
functional, and visual policies remain in force. Historical release and
reference records retain their observed results and are explicitly superseded
where they describe the former planner rule.

## Consequences

Planner timing cannot hold a release. Performance reports distinguish observed
planner timing from the remaining enforced assertions. The changed orchestration
has a new workload identity; an earlier reference is not equivalent evidence for
claims about the updated comparison.
