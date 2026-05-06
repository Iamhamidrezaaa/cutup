# Instalogist engineering (CutUp)

Rules for AI and humans working on this repo.

## Stability first

Ship changes that are easy to reason about and roll back. Prefer small steps over big bangs.

## Incremental workflow

Before implementation:

1. Analyze what exists and what will change.
2. Plan the smallest change that meets the goal.
3. Explain blast radius and tradeoffs.
4. Execute only after that is clear (or stop if scope is unclear).

## Blast radius

For any change that touches architecture, shared modules, routing, data models, or cross-cutting behavior:

- Say what breaks if the change is wrong (extension, website, API, DB, deploy targets).
- Say what must be deployed together and what can stay independent.

## Safe refactors

- No large refactors without explicit approval.
- Refactors should be reversible (easy `git revert`, feature flags, or narrow diffs).
- Do not “clean up” unrelated code in the same change.

## Payment and auth

- Do not modify payment, billing, webhooks, or auth flows without explicit confirmation.
- Treat session, OAuth, Stripe, and invoice paths as high-risk; default to docs and tests around them, not behavioral edits.

## Reversible changes

- Prefer additive changes (new file, new flag, new endpoint) over renames and moves when unsure.
- One concern per PR/commit when possible.

## Scope

- Avoid editing unrelated files.
- Prefer documentation and visibility improvements (maps, checklists, comments where confusing) when they reduce risk without changing behavior.
