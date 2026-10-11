# Launch audit remediation and interface plan

**Goal:** Correct the eleven findings in the [launch audit](2026-10-09-launch-audit.md) and improve the existing landing page, documentation, and playground.

**Scope:** Existing behavior and existing public routes. No additional component families, providers, product features, new framework, paid calls, publication, merge, or deployment. Preserve the historical audit and release evidence. Keep existing quality gates and ADR 014 unchanged.

## Work and ownership

- [x] Input worker: findings 2, 3, 6, 7, and 9. Add failing behavioral regressions, fix form composition, async validation, focus, disabled-fieldset semantics, and zero comparisons. Verify source browser behavior and installed consumer behavior.
- [x] Agent worker: findings 1, 4, and 5. Bind OAuth credentials to an expected issuer using the patched SDK, preserve host-owned action state across authenticated MCP calls, and snapshot admitted input before asynchronous work. Verify malicious metadata, mutation, replay, expiry, and authority boundaries.
- [x] Contributor worker: findings 10 and 11. Link complete setup from the root quickstart and enforce author signoff on newly submitted contribution commits, with explicit automatic-merge and historical-commit treatment.
- [x] Contributor worker: finding 8; primary worker: interface work. Measure the promoted React application entry; remove eager registration of unrelated families while preserving supported rendering. Improve landing-page hierarchy, docs reading/navigation, and playground result visibility using the existing HTML, CSS, Lit, and TypeScript stack.
- [x] Independent review: review the security and lifecycle changes, input semantics, and interface changes across worker boundaries. Correct actionable findings before qualification.
- [x] Qualification: serialize build-based verification; run relevant browser, consumer, docs, accessibility, performance, and release-tooling checks, then the unchanged acceptance matrix against a clean source snapshot. Record fresh results and update STATUS with remaining limits.

## Interface direction

The owner selected a clean editorial direction and rejected the first spacing-only pass as too similar to the previous design. The revised composition uses a centered concise hero, a wider working demo, a neutral site palette, a floating header, a docs guide hub and navigation panel, and a distinct playground task rail and canvas. Keep existing branding, themes, static documentation, and keyboard-accessible navigation. Request JSON remains accessible through a closed disclosure and the existing inspector. Opaque keyboard focus and a scroll-tested mobile toolbar preserve access to controls. Development preview navigation keeps known local routes on the same origin without changing production links or metadata.

## Acceptance and review focus

- Browser checks cover 360, 768, and 1440 pixels, light/dark themes, keyboard navigation, reduced motion, long content, and applicable RTL states. Check actual rendered captures before calling the interface complete.
- Preserve all four scenario journeys and the four-question React quickstart, including responsive view adaptation; byte measurements do not claim production latency improvements.
- Validation races must preserve independent host errors, reject stale completion, and respect reset/disconnect behavior.
- MCP action state must remain bound to immutable authority and scope, with host confirmation, revocation, expiry, and single-use execution.
- New public APIs require export coverage, clean-tarball consumers, package guidance, and an unreleased release note. Do not change package versions or claim a new release.
- Failed or partial checks remain visible; isolated repeats do not become a fabricated uninterrupted matrix receipt.
