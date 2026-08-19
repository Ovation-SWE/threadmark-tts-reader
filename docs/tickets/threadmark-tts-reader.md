# Ticket Breakdown — Threadmark TTS Reader (MVP)

## Epic Summary

Firefox extension (MV2, desktop + Android) that reads SB/SV/QQ serialized fiction aloud,
threadmark by threadmark, using Google Translate TTS blobs played through an `<audio>` element
registered with the Media Session API. Hit play once; the story advances automatically and
resumes exactly where it stopped on reopen.

Architecture doc: `threadmark-tts-reader.arch.md`
PRD: `threadmark-tts-reader.prd.md`

---

## Tickets

### TICKET-1 — Project scaffold + XenForo parser

**Scope / acceptance criteria**
- Initialize TypeScript + Vite + `vite-plugin-web-extension` project. `npm run build` produces a
  valid, loadable extension directory; `web-ext run` loads it in Firefox desktop without errors.
- MV2 `manifest.json` with correct host permissions for SB/SV/QQ and `translate.google.com`,
  content script declaration, background page declaration, popup declaration.
- `src/content/parser.ts` — parses a XenForo threadmark page DOM into:
  ```ts
  interface ThreadmarkPage {
    storyId: string          // hash of the story index URL
    storyTitle: string
    site: "sb" | "sv" | "qq"
    currentUrl: string
    threadmarkTitle: string
    threadmarkIndex: number
    nextUrl: string | null
    prevUrl: string | null
    bodyText: string         // clean text content, no nav/sidebar/footer noise
  }
  ```
- Parser tested with real DOM snapshots captured from at least one story on each of SB, SV, QQ.
  Tests cover: story detection (is this a threadmark page?), content extraction, next/prev URL
  extraction, and correct `null` on the last threadmark.
- If any site uses a different selector for any field, use a per-site selector config map —
  one parser, three selector sets.
- Empty stub entry points: `src/background/index.ts`, `src/content/index.ts`,
  `src/popup/index.html` + `src/popup/index.ts`. These just log "loaded" for now.

**Per-ticket context**
- Architecture: Stack & Libraries section, Component Shape section, XenForo DOM contract
- Spike 2 (XenForo DOM selector validation) is part of this ticket — audit the DOM on all three
  sites before writing the parser, capture snapshots for tests
- `vite-plugin-web-extension` docs for manifest-driven builds

**Files touched (estimate)**
`manifest.json`, `vite.config.ts`, `tsconfig.json`, `package.json`,
`src/content/parser.ts`, `src/content/parser.test.ts`,
`src/__fixtures__/sb-threadmark.html`, `sv-threadmark.html`, `qq-threadmark.html`,
`src/background/index.ts`, `src/content/index.ts`, `src/popup/index.html`, `src/popup/index.ts`

**Rough size:** ~600–800 lines (incl. test fixtures and tests)
**Depends on:** none — greenfield start

---

### TICKET-2 — TTS engine + audio player

**Scope / acceptance criteria**
- `src/content/ttsEngine.ts` — splits arbitrary text into chunks of ≤190 characters at word
  boundaries, returns an async generator of blob URLs fetched from the Google Translate TTS
  endpoint. Handles fetch errors with up to 3 retries (exponential backoff). Revokes previous
  blob URLs when done to avoid memory leaks.
  ```ts
  async function* ttsChunks(text: string): AsyncGenerator<string> // yields blob: URLs
  ```
- `src/content/audioPlayer.ts` — owns a single `<audio>` element injected into the document.
  Registers with the Media Session API (`play`, `pause`, `stop` action handlers; sets
  `MediaMetadata` with story/chapter title). Accepts a chunk generator and plays chunks
  sequentially. Fires a callback when all chunks for a threadmark are exhausted (auto-advance
  signal). Exposes `play()`, `pause()`, `stop()`, `currentCharOffset()`.
- Standalone proof (a temporary script or test): feed a 2000-character block of text, confirm
  all chunks play end-to-end without manual intervention, confirm Media Session controls appear
  in the OS notification shade.
- Unit tests: chunking logic (boundary conditions — word wrap, exact 190 chars, empty string,
  very long words), blob URL lifecycle (revoke called after each chunk).
- Error recovery: if a chunk fetch fails after retries, emit a `"tts-error"` event rather than
  silently stopping.

**Per-ticket context**
- Architecture: TTS Engine section, Boundaries & Contracts (Google Translate endpoint format),
  Component Shape (`audioPlayer.ts`, `ttsEngine.ts`)
- Spike 1 (desktop validation) is already done — the blob + `<audio>` approach is confirmed
- Google Translate endpoint: `https://translate.google.com/translate_tts?ie=UTF-8&q={encoded}&tl=en&client=tw-ob&ttsspeed=1`
- Chunk at ≤190 chars; split at last space before the limit; include `Referer: https://translate.google.com/` header

**Files touched (estimate)**
`src/content/ttsEngine.ts`, `src/content/ttsEngine.test.ts`,
`src/content/audioPlayer.ts`, `src/content/audioPlayer.test.ts`

**Rough size:** ~700–900 lines (incl. tests and mocks for fetch/Audio)
**Depends on:** TICKET-1 (build scaffold, TypeScript setup, types)

---

### TICKET-3 — Playback state persistence + resume

**Scope / acceptance criteria**
- `src/content/stateSync.ts` — reads and writes the following entities to `browser.storage.local`:
  ```ts
  interface Story { id: string; title: string; site: Site; firstThreadmarkUrl: string; lastSeenAt: number }
  interface PlaybackState { storyId: string; currentThreadmarkUrl: string; charOffset: number; updatedAt: number }
  ```
- On content script load on a recognised threadmark page: look up `PlaybackState` for the
  detected story. If found, return the saved threadmark URL and char offset so the orchestrator
  can resume. If the saved URL matches the current page, resume mid-threadmark; if different,
  navigate to the saved URL.
- Writes are throttled — save state at most every 5 seconds during playback, and always on
  `pause` and `stop`. Never on every word/chunk (avoids thrashing storage).
- Unit tests: write → read round-trip, throttle behaviour, resume-on-same-page,
  resume-on-different-page (returns saved URL so orchestrator can navigate).
- `browser.storage.sync` for user preferences (TTS speed, volume) — schema only in this ticket,
  no UI yet.

**Per-ticket context**
- Architecture: Data Model section, Boundaries & Contracts (storage permissions)
- `browser.storage.local` limit is 10 MB — well within range for text state
- `browser.storage.sync` limit is 100 KB — preferences only, not history
- This ticket does NOT include history or favorites (post-MVP non-goals)

**Files touched (estimate)**
`src/content/stateSync.ts`, `src/content/stateSync.test.ts`,
`src/types.ts` (shared entity interfaces used by all modules)

**Rough size:** ~400–550 lines (incl. tests and storage mocks)
**Depends on:** TICKET-1 (shared types, build setup)

---

### TICKET-4 — Content script orchestration + popup UI + background page

**Scope / acceptance criteria**
- `src/content/index.ts` — the main entry point. On load: run parser; if not a threadmark page,
  do nothing. If a threadmark page: check stateSync for saved state, inject the floating
  play/pause/stop control bar (or show it if already injected), restore position if resuming.
  On play: start audioPlayer with chunks from ttsEngine for the current threadmark's text; on
  exhaustion (chapter done), fetch next threadmark URL from parser, navigate the tab (or
  re-inject on the new page) and continue. On error: surface a visible "TTS error — tap to retry"
  message rather than silently stopping.
- `src/popup/index.ts` + `src/popup/index.html` — minimal popup: story title + current
  threadmark name, play/pause button, stop button. Communicates with the content script via
  `browser.tabs.sendMessage`. No elaborate styling — functional and readable.
- `src/background/index.ts` — thin: listens for storage write requests from content scripts (in
  case of CSP restrictions on direct storage access), no audio logic.
- **End-to-end acceptance test (manual):**
  1. Open a SB/SV/QQ threadmark page → floating bar appears
  2. Hit play → TTS starts reading the chapter
  3. Chapter ends → next chapter loads and TTS continues without touching the screen
  4. Hit pause → audio stops; state is saved
  5. Reload the page (or close and reopen the tab) → audio resumes from the saved threadmark
  6. Hit stop → state is cleared

**Per-ticket context**
- Architecture: Recommended Approach, Component Shape, Boundaries & Contracts (CSP note)
- Tab navigation between threadmarks: use `parser.nextUrl` and `window.location.assign()` from
  the content script (no `tabs` permission needed for same-tab navigation)
- Popup ↔ content script messaging: `browser.tabs.sendMessage` from popup; `browser.runtime.onMessage` in content script
- CSP open question: if `blob:` URLs are blocked by site CSP, fall back to `ArrayBuffer` + Web Audio API decode

**Files touched (estimate)**
`src/content/index.ts`, `src/popup/index.ts`, `src/popup/index.html`,
`src/background/index.ts`, possibly `src/content/audioPlayer.ts` (minor wiring adjustments)

**Rough size:** ~600–800 lines
**Depends on:** TICKET-2 and TICKET-3 (both must be implemented before wiring)

---

## Dependency Graph

```
TICKET-1 (scaffold + parser)
    │
    ├──────────────────────┐
    ▼                      ▼
TICKET-2                TICKET-3
(TTS + audio)           (state persistence)
    │                      │
    └──────────┬───────────┘
               ▼
           TICKET-4
     (orchestration + UI)
```

---

## Suggested Execution Order

**Wave 1:** TICKET-1 — must go first; establishes build, types, and the parser all subsequent tickets depend on.

**Wave 2 (parallel):** TICKET-2 and TICKET-3 — no shared files, no shared output. Can run in parallel worktrees once TICKET-1 is merged.

**Wave 3:** TICKET-4 — wires everything together. Plan it after TICKET-2 and TICKET-3 are implemented (their actual APIs will inform the wiring, not a guess).

---

## Open Risks (carry into each ticket)

- **CSP + blob URLs** — if SB/SV/QQ blocks `blob:` in content script context, TICKET-2 needs the Web Audio API fallback path instead of `<audio src="blob:...">`. Audit response headers during TICKET-1's DOM inspection.
- **Mobile backgrounding** — confirmed on desktop; real-device test on Firefox for Android is the first acceptance check after TICKET-4 ships.
- **Google Translate rate limiting** — unlikely for single-user use but monitor during TICKET-4 end-to-end testing. If 429s appear, add a small delay between chunk fetches.
