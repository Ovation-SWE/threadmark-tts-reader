---
name: project-overview
description: Core purpose, MVP hypothesis, and target platforms for forum-reader
metadata:
  type: project
---

Firefox extension (MV2, desktop + Android) — reads serialized web fiction on Spacebattles (SB), Sufficient Velocity (SV), and Questionable Questing (QQ) aloud, threadmark-by-threadmark, hands-free. Core promise: hit play once, put the phone down.

**Why:** Generic TTS tools stop at page boundaries; XenForo sites structure stories as a linked list of threadmarks that a purpose-built extension can auto-advance through.

**MVP hypothesis:** TTS via Google Translate audio blobs + `<audio>` element + Media Session API allows playback to survive mobile backgrounding (the main UX blocker).

**How to apply:** All architecture decisions flow from "survive mobile backgrounding." Any design that can't keep audio alive on Firefox Android is rejected at the proposal stage.
