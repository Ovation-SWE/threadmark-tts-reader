---
name: ticket-roadmap
description: Ticket status and dependency graph for the forum-reader MVP
metadata:
  type: project
---

TICKET-1 (scaffold + XenForo parser) — COMPLETE as of 2026-08-19. PR #1 merged; review findings addressed (tsconfig node type leak, regex capture group, tsconfig.test.json module override).

TICKET-2 (TTS engine + audio player) — NOT STARTED. Parallel with TICKET-3.
TICKET-3 (playback state persistence + resume) — PLANNED. Plan at `.claude/plans/ticket-3-playback-state-persistence.md`.
TICKET-4 (orchestration + popup UI) — NOT STARTED. Depends on TICKET-2 and TICKET-3.

Dependency graph:
```
TICKET-1 → TICKET-2 ─┐
         → TICKET-3 ─┴→ TICKET-4
```

**How to apply:** TICKET-2 and TICKET-3 can run in parallel worktrees. TICKET-4 must wait for both. Don't start TICKET-4 planning until TICKET-2 and TICKET-3 are merged (actual APIs inform the wiring).
