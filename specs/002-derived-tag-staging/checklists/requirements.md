# Specification Quality Checklist: Derived-Tag Versioning & Branch-as-Environment Staging

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-06-08
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

> Note: this is a template-infrastructure feature, so some requirements necessarily name concrete
> mechanisms (git tags, `APP_ENV`, CI jobs) — those ARE the user-facing surface of a developer-tooling
> template, not leaked implementation. Requirements stay at the "what the template guarantees" level;
> the "how" (exact bash, YAML) is deferred to plan/implementation.

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (as far as a dev-tooling template allows — outcomes are
      stated as observable tag/endpoint/header results, not internal code)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- The infra/runtime findings live in snackbyte-site `specs/001-staging-environment/spec.md` (Divergence
  Log); this spec formalizes them for the template (proven-live, ported). The versioning derivation is a
  refinement, not a verbatim port (see the LOCKED note below).
- Principle VIII (no spec/FR citations in shipped files) is itself a requirement (FR-028) — the plan
  must enforce it when porting snackbyte-site's annotated files.
- **Versioning model LOCKED (2026-06-09):** global build-id (`max(all v<MM>.*)+1`) + symmetric
  `--points-at HEAD` reuse + promotion gate (`main` ⊆ `dev`). This **refines** snackbyte-site's as-built
  ancestry logic (which jams on resume-direct-to-main) — so the model is proven-in-logic, NOT yet
  proven-live. It's verified by a fresh-app spin-up; snackbyte-site (the guinea pig) is the live feedback
  loop. The plan must treat the workflow derivation as NEW work to verify, not a verbatim port.
- **Strategy (2026-06-09):** template is the source of truth; nothing is in production use, so existing
  apps are **re-spun**, not migrated. No migration guide / backport prompt (removed from scope).
  Downstream consumer apps are out of the template's frame; snackbyte-site is the named exception (guinea
  pig / direct extension / feedback loop), not a downstream consumer.
- Plan + contracts complete.
