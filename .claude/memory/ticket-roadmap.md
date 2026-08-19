---
name: ticket-roadmap
description: Ticket status and dependency graph for the forum-reader MVP
metadata:
  type: project
---

TICKET-1 (scaffold + XenForo parser) — COMPLETE as of 2026-08-19. PR #1 merged; review findings addressed (tsconfig node type leak, regex capture group, tsconfig.test.json module override).

TICKET-2 (TTS engine + audio player) — COMPLETE as of 2026-08-19. 85 tests passing total.
TICKET-3 (playback state persistence + resume) — COMPLETE as of 2026-08-19. Merged with TICKET-2 (515f322).
TICKET-4 (orchestration + popup UI) — PLANNED. Plan at `.claude/plans/ticket-4-orchestration-popup-ui.md`.

Dependency graph:
```
TICKET-1 → TICKET-2 ─┐
         → TICKET-3 ─┴→ TICKET-4
```

**How to apply:** TICKET-2 and TICKET-3 can run in parallel worktrees. TICKET-4 must wait for both. Don't start TICKET-4 planning until TICKET-2 and TICKET-3 are merged (actual APIs inform the wiring).
