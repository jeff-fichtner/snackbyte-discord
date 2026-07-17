# Feature Specification: Voice Moderation

**Feature Branch**: `018-voice-moderation` *(not yet created)*

**Status**: 🌱 STUB — outline only. Run `/speckit-specify` on this to elaborate into a full spec.

**Priority**: P3 — a small, self-contained moderation extension; niche relative to text/member moderation.

**Depends on**: 006 (the moderation gate/guard shape it reuses).

---

## Scope (one paragraph)

The voice-channel slice of moderation, deferred out of 006 because it's a distinct permission and
target set. A moderator can **move** a member between voice channels, **disconnect** a member from
voice, and **server-mute / server-deafen** a member in voice — each gated by the relevant native
permission (Move Members / Mute Members / Deafen Members), reusing the same
native-permission + hierarchy-guard + fail-safe shape as 006's member sanctions.

## Why it's its own spec

It targets voice state rather than the text/role/member surface everything else works on, and needs a
different permission set. Small enough to be a quick addition, distinct enough not to belong inside
006's already-wide scope. Stateless (acts on live voice state), so no dependency on 007.

## Key open questions (resolve during `/speckit-specify`)

- Whether this ships as slash commands only, or also components/context-menus (reusing the style
  adapters from 006).
- Move-target selection UX (which voice channel).

## Out of scope

Anything requiring durable state (voice-session records) — same stateless boundary as 006.
