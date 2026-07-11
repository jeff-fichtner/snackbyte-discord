# Feature Specification: Multiple Secrets Per Source

**Feature Branch**: `013-multi-secret-per-source` *(not yet created)*

**Status**: 🌱 STUB — outline only. **CONDITIONAL** — build only if the need actually arises. Run `/speckit-specify` when it does.

**Priority**: Demand-driven — do NOT build speculatively. Only when a source genuinely needs multiple webhooks each with its own secret.

**Depends on**: the existing source-adapter + `sources.secret_ref` model.

**Source**: ARCHITECTURE.md §5 open question 2.

---

## Scope (one paragraph)

Today the hub uses **one signing secret per source slug** (`sources.secret_ref`). Some setups need
**many webhooks per source**, each with its own secret — e.g. several ClickUp workspaces all posting
to the `clickup` source, each configured with a different signing secret. This spec would add
**per-webhook source rows or a secret-per-webhook lookup** so verification (Principle II) resolves the
correct secret per incoming webhook rather than assuming one per source.

## Why it's conditional (not a committed spec)

It solves a real but **not-yet-present** need. Building it before any source requires multiple secrets
is speculative complexity — exactly what the constitution's "unjustified complexity is rejected" guard
warns against. Kept as a numbered stub so the option is visible and the design direction is recorded,
but it should stay unbuilt until a concrete multi-webhook source appears.

## Key open questions (resolve if/when built)

- Per-webhook rows (a `source_webhooks` table) vs. a secret list on the source row.
- How an inbound request selects its webhook identity (path segment? header? per-provider scheme).
- Migration path from the current one-secret-per-source model without breaking existing sources.

## Out of scope

Anything beyond secret resolution per webhook — routing/transform/delivery are unaffected.
