# Replayable presentation plans and resolved rendering data

Status: accepted for the unreleased 0.1.0 implementation.

A real form adaptation test exposed a failed round trip: the presentation compiler
replaced a node's binding reference with expanded host configuration. A subsequent
resize replayed that configuration through the input validator, which correctly
rejected labels, defaults and domain targets in an untrusted proposal.

`ValidatedPresentation.plan` and each resolved node's `.node` retain the validated
wire configuration. The sibling `.config` contains the separately validated,
frozen rendering values, field coverage, operations and ports. Renderers consume
that resolved configuration; persistence, revalidation and adaptation consume the
wire plan. Both remain in the same canonical presentation pipeline.

No wire schema or version changes. This fixes an unreleased compiler output;
there is no published customer-state migration. Host-expanded configurations
remain invalid as proposals, and host binding revisions still require revalidation.

Evidence: the core presentation replay regression first failed, then passed with
this separation. The actual default web region now replays its text-field/table
plan across wide, narrow and text-scale transitions while preserving an unfinished
draft. Independent review checked rendering consumers and the replay boundary.
