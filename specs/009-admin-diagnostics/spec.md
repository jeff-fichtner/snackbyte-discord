# Feature Specification: Admin & Diagnostics Surface

**Feature Branch**: `009-admin-diagnostics` *(not yet created)*

**Status**: 🌱 STUB — outline only. Run `/speckit-specify` on this to elaborate into a full spec.

**Priority**: P2 — quality-of-life for operators; the hub runs without it (the Supabase table editor is the day-one admin UI).

**Depends on**: nothing hard; complements every prior feature by making their runtime data inspectable/manageable.

**Source**: ARCHITECTURE.md Phase 2 remainder + §5 open question 4 ("admin surface boundary").

---

## Scope (one paragraph)

The operator conveniences deferred throughout: an **admin/diagnostics endpoint (or in-Discord
operator commands)** beyond hand-editing Supabase rows. Concretely — inspect configured routes, view
and **replay `delivery_log`** entries (re-run a failed delivery), and **in-Discord operator commands
to curate runtime data** (the self-assignable-role whitelist from 004, the reaction-role mappings from
005, the component bindings from 006) so an operator can manage them without opening the table editor.
This is the "convenient operator command" repeatedly deferred in 004/005/006.

## Why it's its own spec

It's a cross-cutting operator surface, not tied to one capability. It also forces the ARCHITECTURE §5
Q4 decision: when the table editor stops being sufficient and a purpose-built **authenticated** admin
endpoint/UI is warranted. Best done once, spanning all the runtime-data types, rather than a one-off
command per feature.

## ⚠️ Framing note — this may become "the composer" (ARCHITECTURE §5 Q6)

Decide BEFORE speccing: is this diagnostics-only (Tier 1 — curate the existing rows), or the surface
where operators **compose command instances** from code-defined types (Tier 2)? The two produce very
different UIs, and building the diagnostics-only version first risks a throwaway. §5 Q6 argues Tier 2
is the plausible direction and that the existing capability/adapter split already supports it. Settle
that question here rather than inheriting it.

## Key open questions (resolve during `/speckit-specify`)

- In-Discord commands (operator-permission-gated) vs. a web admin endpoint vs. both.
- Authentication for any web surface (the table editor is Supabase-auth'd today; a custom endpoint
  needs its own).
- Replay semantics for `delivery_log` (idempotency: a replay must respect the dedupe key).

## Out of scope

A full rich admin web app (ARCHITECTURE Phase 4 "richer admin UI if the table editor outgrows its
role") — this is the first diagnostics/curation layer, not a full console.
