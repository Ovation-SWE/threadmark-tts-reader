# Feature: TICKET-4 — Content Script Orchestration + Popup UI + Background Page

The following plan should be complete, but validate documentation and codebase patterns before implementing.
Pay special attention to naming of existing types, imports, and the exact APIs exposed by the already-implemented
TICKET-2 (`AudioPlayer`, `ttsChunks`) and TICKET-3 (`stateSync`, `ThrottledStateWriter`, `resolveResume`) modules.
Read those source files before writing a single line.

## Feature Description

Wire the four previously-implemented modules (`parser`, `ttsEngine`, `audioPlayer`, `stateSync`) into a working
extension. The content script becomes the primary orchestrator: it parses the current page, resolves saved
playback state, injects a floating control bar, drives the audio pipeline, persists progress, and auto-advances
to the next chapter when a chapter ends. A minimal popup shows story/chapter info and play/pause/stop controls
that message the content script. The background page is thin — it initialises default preferences on install.

## User Story

As a reader of serialized fiction on SB, SV, or QQ,
I want to hit play once and have the story read itself through chapter boundaries, surviving page reloads and
app backgrounding,
So that I can listen hands-free without touching my phone between start and finish.

## Problem Statement

TICKET-1 built the parser. TICKET-2 built the TTS engine and audio player. TICKET-3 built playback state
persistence. None of it runs yet — `src/content/index.ts`, `src/popup/index.ts`, and `src/background/index.ts`
are single-line stubs. This ticket provides the missing glue: the orchestration logic and the user-facing UI
surface.

## Solution Statement

The content script's `init()` function runs on every injected threadmark page. It resolves saved state, injects
a fixed-position control bar, and drives the `AudioPlayer` → `ThrottledStateWriter` → auto-advance loop. The
popup sends messages to the content script via `browser.tabs.sendMessage` and displays the response. A shared
`src/messages.ts` module defines the message and state types used by both sides.

## Out of Scope / Non-Goals

- Not included: within-chapter resume precision (resume at charOffset > 0 within a chapter). MVP always restarts
  from the beginning of the saved threadmark. charOffset is written to storage and drives the navigate/resume-here
  decision, but is not used to skip ahead within TTS chunks.
- Not included: CSP fallback (ArrayBuffer + Web Audio API if blob URLs are blocked). Flag as open risk.
- Not included: pre-fetching the next chapter's audio while the current one plays (post-MVP).
- Not included: preferences UI (schema exists from TICKET-3, no UI yet).
- Not included: history, favorites, crosspost clustering (post-MVP non-goals from PRD).
- Not changing: `parser.ts`, `ttsEngine.ts`, `audioPlayer.ts`, `stateSync.ts`, `types.ts`, `manifest.json`
  (content-script path already correct), test fixtures.
- Not included: `tabs` permission usage beyond `browser.tabs.query` in the popup (already in manifest).

## Feature Metadata

**Feature Type**: New Capability (integration / orchestration)
**Estimated Complexity**: Medium
**Primary Systems Affected**: `src/content/index.ts`, `src/popup/index.ts`, `src/popup/index.html`,
`src/background/index.ts`
**Dependencies**: TICKET-2 (`AudioPlayer`, `ttsChunks`, `TtsChunk`), TICKET-3 (`stateSync` module,
`ThrottledStateWriter`, `types.ts`)

## Related Work

**Implements**: TICKET-4 · `docs/tickets/threadmark-tts-reader.md` (lines 139–170)
**Epic**: `threadmark-tts-reader.arch.md` — Recommended Approach, Component Shape, Boundaries & Contracts

**Back-references**:
- `.claude/plans/ticket-2-tts-engine-audio-player.md` — defines `AudioPlayer` API and `TtsChunk` type consumed here
- `.claude/plans/ticket-3-playback-state-persistence.md` — defines `stateSync` API, `ThrottledStateWriter`,
  `resolveResume`, and `ResumeAction` consumed here

**Forward-references**:
- (none yet — this is the final MVP ticket)

---

## CONTEXT REFERENCES

### Relevant Codebase Files — MUST READ BEFORE IMPLEMENTING

- `src/content/parser.ts` (lines 11–23) — `ThreadmarkPage` interface, `isThreadmarkPage()`,
  `parseThreadmarkPage()`. These are the orchestrator's first two calls.
- `src/content/audioPlayer.ts` (full, 90 lines) — `AudioPlayer` constructor signature
  `(doc: Document, options: AudioPlayerOptions)`, `play(chunks, metadata?)`, `pause()`, `resume()`, `stop()`,
  `currentCharOffset()`. The `onExhausted` / `onError` callbacks are the hooks for auto-advance and error UI.
- `src/content/ttsEngine.ts` (lines 62–89) — `ttsChunks(text: string): AsyncGenerator<TtsChunk>`. This is the
  generator passed to `AudioPlayer.play()`.
- `src/content/stateSync.ts` (full, 109 lines) — `saveStory`, `loadStory`, `loadPlaybackState`,
  `savePlaybackState`, `clearPlaybackState`, `resolveResume`, `ThrottledStateWriter`, `loadPreferences`,
  `savePreferences`. Know ALL of these — the orchestrator calls most of them.
- `src/types.ts` (full, 26 lines) — `Story`, `PlaybackState`, `UserPreferences`, `ResumeAction`. Import from
  here, never redefine.
- `src/content/parser.test.ts` (lines 1–12) — canonical import pattern for Vitest; explicit imports from
  `"vitest"` even with `globals: true`.
- `src/content/audioPlayer.test.ts` (lines 1–18) — `tick()` helper, `makeChunks()`, `fireEnded()` patterns.
  The orchestrator test will need similar async-drain helpers.
- `src/__fixtures__/mockBrowser.ts` (full, 32 lines) — `makeMockBrowser()` factory. Use this in all tests.
- `vitest.config.ts` — `environment: "jsdom"`, `globals: true`.
- `tsconfig.json` — `"types": ["firefox-webext-browser"]`. `browser.*` globals are in scope.

### New Files to Create

- `src/messages.ts` — `ContentMessage` union + `ContentState` interface (shared by content + popup)
- `src/content/index.ts` — full orchestrator replacing stub (REWRITE)
- `src/content/index.test.ts` — unit tests for orchestrator
- `src/popup/index.html` — full popup HTML replacing stub (REWRITE)
- `src/popup/index.ts` — popup controller replacing stub (REWRITE)
- `src/popup/index.test.ts` — unit tests for popup
- `src/background/index.ts` — thin background, prefs init on install (REWRITE)

### Relevant Documentation — READ BEFORE IMPLEMENTING

- `threadmark-tts-reader.arch.md` §Recommended Approach — the content script is the primary actor; background
  page is thin; popup uses `browser.tabs.sendMessage`.
- `threadmark-tts-reader.arch.md` §Component Shape — the exact file layout this plan implements.
- `threadmark-tts-reader.arch.md` §Boundaries & Contracts — CSP + blob URL risk (out of scope for TICKET-4 but
  must not accidentally paper over the open question).
- `docs/tickets/threadmark-tts-reader.md` §TICKET-4 (lines 139–170) — acceptance criteria and per-ticket context.
- `.claude/plans/ticket-3-playback-state-persistence.md` §OPEN QUESTIONS/ASSUMPTIONS — the "stop calls
  clearPlaybackState" assumption is confirmed here; flush is for pause only.

### Patterns to Follow

**Module structure (from `parser.ts`, `ttsEngine.ts`, `stateSync.ts`):**
- Named exports only. No default exports.
- Types/interfaces at top of file, exported inline.
- Module-level constants in `SCREAMING_SNAKE`.

**Import style (from `audioPlayer.test.ts:1`):**
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
```
Explicit imports always — `vi` is NOT auto-injected even with `globals: true`.

**Error surfacing (from `parser.ts:154`):**
```ts
throw new Error(`Unsupported site: ${hostname}`);
```
Surface the offending value. In the orchestrator, errors go to the UI bar (not thrown).

**Guard for `navigator.mediaSession` (from `audioPlayer.ts:20`):**
```ts
if ("mediaSession" in navigator) { ... }
```
Mirror this anywhere conditional browser APIs are called.

**Async generator consumption (from `audioPlayer.ts:63`):**
```ts
for await (const chunk of chunks) {
  if (signal.aborted) return;
  ...
}
```
Signal-based cancellation is the pattern already in place.

**Mock browser pattern (from `stateSync.test.ts`):**
```ts
beforeEach(() => {
  vi.stubGlobal("browser", makeMockBrowser());
});
afterEach(() => { vi.unstubAllGlobals(); });
```

**Auto-execution guard (new pattern for this ticket):**
```ts
// At bottom of src/content/index.ts — runs in browser build, not in Vitest
/// <reference types="vite/client" />  ← add at top of file
if (import.meta.env.MODE !== "test") {
  void init().catch(console.error);
}
```
Vite replaces `import.meta.env.MODE` at build time with `"production"`. Vitest sets it to `"test"`.
This allows `init()` to be exported and called explicitly in tests without double-execution.
Add `/// <reference types="vite/client" />` at the TOP of `src/content/index.ts`.

---

## DESIGN DECISIONS

### Message protocol

```ts
// src/messages.ts

export type ContentMessage =
  | { type: "getState" }
  | { type: "play" }
  | { type: "pause" }
  | { type: "stop" };

export interface ContentState {
  storyTitle: string;
  threadmarkTitle: string;
  isPlaying: boolean;
  isPaused: boolean;
  errorMessage: string | null;
  hasNextChapter: boolean;
}
```

`"play"` means "start if stopped, resume if paused" — the content script decides which. The popup button
toggles between sending `"play"` and `"pause"` based on `isPlaying` from the last `getState` response.

### Auto-advance state machine

Before navigating to the next chapter, the orchestrator writes a `PlaybackState` pointing to `nextUrl` with
`charOffset: 0`. On the new page, `resolveResume(nextUrl, state)` returns `{ type: "resume-here", charOffset: 0 }`,
which triggers auto-play. This reuses the existing `resolveResume` contract without a separate "auto-advance" flag.

```
onExhausted fires
  → page.nextUrl exists?
      YES: savePlaybackState({ currentThreadmarkUrl: nextUrl, charOffset: 0 })
           writer.destroy()
           window.location.assign(nextUrl)
      NO (last chapter): clearPlaybackState(storyId)
                         writer.destroy()
                         updateBar("stopped")
```

### Resume granularity (MVP)

`resolveResume` returns `"resume-here"` → orchestrator always calls `player.play(ttsChunks(page.bodyText), ...)` 
from the beginning of the chapter. The `charOffset` in `PlaybackState` is written (so future within-chapter
resume can use it) but NOT used to skip ahead in the generator. Acceptable per TICKET-3 open question.

### Progress tracking

A `setInterval(1000)` timer fires while playing. Each tick calls `writer.enqueue({ ..., charOffset: player.currentCharOffset() })`. The `ThrottledStateWriter` handles the actual ≤5s write throttle. Timer is cleared on pause/stop.

### `Story.firstThreadmarkUrl` upsert

Load existing `Story` before saving; preserve `firstThreadmarkUrl` if it exists, else use the current URL as
approximate first-chapter URL. Always update `lastSeenAt`.

### Floating control bar

Injected into `document.body` as a `<div id="threadmark-tts-bar">`. IDs are prefixed `tts-` to reduce collision
risk. A `<style id="threadmark-tts-style">` tag accompanies it. Fixed position, bottom-right. No Shadow DOM for
MVP. The bar is checked for existence before injection (`document.getElementById("threadmark-tts-bar")`) to avoid
double-injection if the content script somehow re-runs.

### `"navigate"` action

When `resolveResume` returns `"navigate"` (user is on a different chapter than where they stopped), the content
script calls `window.location.assign(action.url)` immediately without prompting. This matches AC #5: "Reload the
page → audio resumes from the saved threadmark." The bar is NOT injected in this case (navigation is immediate).

### Popup state refresh

Popup queries state once on open. Button clicks send commands and update button label optimistically. No polling.
If the content script isn't on the active tab (non-threadmark page), `browser.tabs.sendMessage` rejects — caught
and the "open a threadmark page" fallback is shown.

---

## IMPLEMENTATION PLAN

### Phase 1: Shared message types (`src/messages.ts`)

**Independent of all other phases.**

Define the protocol types used by both content script and popup.

**Tasks:**
- CREATE `src/messages.ts`

### Phase 2: Content script orchestrator (`src/content/index.ts` + tests)

**Depends on:** Phase 1 (imports `ContentMessage`, `ContentState`)

The bulk of the work. All TICKET-2/3 APIs are imported and wired here.

**Tasks:**
- REWRITE `src/content/index.ts`
- CREATE `src/content/index.test.ts`

### Phase 3: Popup (`src/popup/index.html` + `src/popup/index.ts` + tests)

**Depends on:** Phase 1 (imports `ContentMessage`, `ContentState`). **Independent of Phase 2** (uses messages,
not direct imports from content script).

**Tasks:**
- REWRITE `src/popup/index.html`
- REWRITE `src/popup/index.ts`
- CREATE `src/popup/index.test.ts`

### Phase 4: Background page (`src/background/index.ts`)

**Independent of Phases 2 and 3.**

Thin: initialise preferences on install.

**Tasks:**
- REWRITE `src/background/index.ts`

### Phase 5: Validation

**Depends on:** Phases 1–4 complete.

---

## STEP-BY-STEP TASKS

### CREATE `src/messages.ts`

- **IMPLEMENT**:
  ```ts
  export type ContentMessage =
    | { type: "getState" }
    | { type: "play" }
    | { type: "pause" }
    | { type: "stop" };

  export interface ContentState {
    storyTitle: string;
    threadmarkTitle: string;
    isPlaying: boolean;
    isPaused: boolean;
    errorMessage: string | null;
    hasNextChapter: boolean;
  }
  ```
- **GOTCHA**: This file is imported by both `src/content/index.ts` and `src/popup/index.ts`. Vite bundles each
  entry separately; both bundles will inline this tiny module. That's fine — no circular dependency risk.
- **VALIDATE**: `npx tsc --noEmit`
- **SATISFIES**: Shared contract between popup and content script

---

### REWRITE `src/content/index.ts`

Add `/// <reference types="vite/client" />` as the FIRST LINE.

- **IMPLEMENT imports**:
  ```ts
  /// <reference types="vite/client" />
  import { isThreadmarkPage, parseThreadmarkPage } from "./parser";
  import type { ThreadmarkPage } from "./parser";
  import { AudioPlayer } from "./audioPlayer";
  import { ttsChunks } from "./ttsEngine";
  import {
    saveStory, loadStory, loadPlaybackState, savePlaybackState,
    clearPlaybackState, resolveResume, ThrottledStateWriter,
    loadPreferences,
  } from "./stateSync";
  import type { ContentMessage, ContentState } from "../messages";
  ```

- **IMPLEMENT**: Module-level state (mutable, lives for the lifetime of the content script):
  ```ts
  let _player: AudioPlayer | null = null;
  let _writer: ThrottledStateWriter | null = null;
  let _progressTimer: ReturnType<typeof setInterval> | null = null;
  let _isPlaying = false;
  let _isPaused = false;
  let _errorMessage: string | null = null;
  let _page: ThreadmarkPage | null = null;
  ```

- **IMPLEMENT**: `function injectBar(storyTitle: string, threadmarkTitle: string): void`
  - Guard: if `document.getElementById("threadmark-tts-bar")` exists, return early.
  - Inject `<style id="threadmark-tts-style">` with CSS for the bar (see CSS block below).
  - Inject `<div id="threadmark-tts-bar">` into `document.body` (see HTML structure below).
  - Attach click listeners to `#tts-btn-play` and `#tts-btn-stop`.

  **Bar HTML structure** (injected programmatically, not as an HTML string to avoid XSS with titles):
  ```
  <div id="threadmark-tts-bar">
    <div id="tts-title"></div>      ← set via textContent, not innerHTML
    <div id="tts-chapter"></div>    ← set via textContent
    <div id="tts-controls">
      <button id="tts-btn-play">▶</button>
      <button id="tts-btn-stop">■</button>
    </div>
    <div id="tts-error" style="display:none"></div>
  </div>
  ```

  **Bar CSS** (inline via `<style>` tag):
  ```css
  #threadmark-tts-bar {
    position: fixed; bottom: 16px; right: 16px; z-index: 2147483647;
    background: #1a1a2e; color: #e8e8e8; border-radius: 8px;
    padding: 10px 14px; font-family: sans-serif; font-size: 13px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.6); min-width: 200px; max-width: 300px;
    line-height: 1.4;
  }
  #tts-title { font-weight: bold; margin-bottom: 2px; }
  #tts-chapter { color: #aaa; font-size: 11px; margin-bottom: 8px; }
  #tts-controls { display: flex; gap: 8px; }
  #tts-controls button {
    flex: 1; padding: 6px; cursor: pointer; border: none; border-radius: 4px;
    background: #333; color: #e8e8e8; font-size: 16px;
  }
  #tts-controls button:hover { background: #555; }
  #tts-error { color: #ff6b6b; font-size: 11px; margin-top: 6px; }
  ```

  Set `textContent` (NOT `innerHTML`) for title/chapter to prevent XSS from story titles.

- **IMPLEMENT**: `function updateBarState(state: Pick<ContentState, "isPlaying" | "isPaused" | "errorMessage">): void`
  - Sets `#tts-btn-play` text: `"⏸"` if `isPlaying`, else `"▶"`.
  - Sets `#tts-error` visibility and text.
  - No-op if bar isn't injected yet (guard with `getElementById`).

- **IMPLEMENT**: `async function startProgressTimer(): Promise<void>` — a simple helper that:
  ```ts
  function startProgressTimer(): void {
    stopProgressTimer();
    _progressTimer = setInterval(() => {
      if (!_isPlaying || !_player || !_page) return;
      _writer?.enqueue({
        storyId: _page.storyId,
        currentThreadmarkUrl: _page.currentUrl,
        charOffset: _player.currentCharOffset(),
        updatedAt: Date.now(),
      });
    }, 1000);
  }

  function stopProgressTimer(): void {
    if (_progressTimer !== null) {
      clearInterval(_progressTimer);
      _progressTimer = null;
    }
  }
  ```

- **IMPLEMENT**: `async function playAudio(): Promise<void>`
  ```ts
  async function playAudio(): Promise<void> {
    if (!_player || !_page) return;
    const prefs = await loadPreferences();
    _isPlaying = true;
    _isPaused = false;
    _errorMessage = null;
    updateBarState({ isPlaying: true, isPaused: false, errorMessage: null });
    await savePlaybackState({
      storyId: _page.storyId,
      currentThreadmarkUrl: _page.currentUrl,
      charOffset: 0,
      updatedAt: Date.now(),
    });
    _player.play(
      ttsChunks(_page.bodyText),
      { title: _page.storyTitle, artist: _page.threadmarkTitle }
    );
    startProgressTimer();
    // Apply preferences (ttsSpeed not exposed by AudioPlayer in MVP — documented in open questions)
    void prefs; // prefs loaded for future use; ttsSpeed/volume wiring is post-MVP
  }
  ```
  **GOTCHA**: `loadPreferences()` is called here so the pattern is established; applying `prefs.ttsSpeed` to the
  `<audio>` element's `playbackRate` is post-MVP wiring — document it in OPEN QUESTIONS, don't skip the call.

- **IMPLEMENT**: `async function pauseAudio(): Promise<void>`
  ```ts
  async function pauseAudio(): Promise<void> {
    if (!_player) return;
    _isPlaying = false;
    _isPaused = true;
    stopProgressTimer();
    _player.pause();
    await _writer?.flush();
    updateBarState({ isPlaying: false, isPaused: true, errorMessage: null });
  }
  ```

- **IMPLEMENT**: `async function stopAudio(): Promise<void>`
  Per TICKET-3 assumption: stop calls `clearPlaybackState`, NOT flush. `writer.destroy()` cancels pending timer
  without writing.
  ```ts
  async function stopAudio(): Promise<void> {
    if (!_player || !_page) return;
    _isPlaying = false;
    _isPaused = false;
    stopProgressTimer();
    _player.stop();
    _writer?.destroy();
    await clearPlaybackState(_page.storyId);
    updateBarState({ isPlaying: false, isPaused: false, errorMessage: null });
  }
  ```

- **IMPLEMENT**: `export async function init(): Promise<void>` — the main orchestration function:
  ```ts
  export async function init(): Promise<void> {
    const url = window.location.href;
    if (!isThreadmarkPage(document, url)) return;

    const page = parseThreadmarkPage(document, url);
    _page = page;

    // Upsert Story record (preserve firstThreadmarkUrl if already known)
    const existingStory = await loadStory(page.storyId);
    await saveStory({
      id: page.storyId,
      title: page.storyTitle,
      site: page.site,
      firstThreadmarkUrl: existingStory?.firstThreadmarkUrl ?? page.currentUrl,
      lastSeenAt: Date.now(),
    });

    // Resolve resume action
    const savedState = await loadPlaybackState(page.storyId);
    const resumeAction = resolveResume(page.currentUrl, savedState);

    if (resumeAction.type === "navigate") {
      window.location.assign(resumeAction.url);
      return; // page is navigating; stop here
    }

    // Inject UI
    injectBar(page.storyTitle, page.threadmarkTitle);

    // Wire audio
    _writer = new ThrottledStateWriter();
    _player = new AudioPlayer(document, {
      onExhausted: () => { void handleExhausted(); },
      onError: (err) => {
        _isPlaying = false;
        _isPaused = false;
        stopProgressTimer();
        _errorMessage = `TTS error — ${err.message}`;
        updateBarState({ isPlaying: false, isPaused: false, errorMessage: _errorMessage });
      },
    });

    // Message handler for popup
    browser.runtime.onMessage.addListener((msg: unknown) => {
      return handleMessage(msg as ContentMessage);
    });

    // Page unload — cancel any pending writes
    window.addEventListener("beforeunload", () => {
      _writer?.destroy();
    });

    // Auto-play if resuming
    if (resumeAction.type === "resume-here") {
      void playAudio();
    }
  }
  ```

- **IMPLEMENT**: `async function handleExhausted(): Promise<void>`
  ```ts
  async function handleExhausted(): Promise<void> {
    if (!_page) return;
    _isPlaying = false;
    stopProgressTimer();

    if (!_page.nextUrl) {
      // Last chapter — story complete
      _writer?.destroy();
      await clearPlaybackState(_page.storyId);
      updateBarState({ isPlaying: false, isPaused: false, errorMessage: null });
      return;
    }

    // Save state pointing to next chapter, then navigate
    await savePlaybackState({
      storyId: _page.storyId,
      currentThreadmarkUrl: _page.nextUrl,
      charOffset: 0,
      updatedAt: Date.now(),
    });
    _writer?.destroy();
    window.location.assign(_page.nextUrl);
  }
  ```

- **IMPLEMENT**: `function handleMessage(msg: ContentMessage): Promise<ContentState | void>`
  ```ts
  function handleMessage(msg: ContentMessage): Promise<ContentState | void> {
    switch (msg.type) {
      case "getState":
        return Promise.resolve({
          storyTitle: _page?.storyTitle ?? "",
          threadmarkTitle: _page?.threadmarkTitle ?? "",
          isPlaying: _isPlaying,
          isPaused: _isPaused,
          errorMessage: _errorMessage,
          hasNextChapter: (_page?.nextUrl ?? null) !== null,
        } satisfies ContentState);
      case "play":
        if (_isPaused && _player) {
          _isPaused = false;
          _isPlaying = true;
          _player.resume();
          startProgressTimer();
          updateBarState({ isPlaying: true, isPaused: false, errorMessage: null });
        } else if (!_isPlaying) {
          void playAudio();
        }
        return Promise.resolve();
      case "pause":
        return pauseAudio();
      case "stop":
        return stopAudio();
    }
  }
  ```

- **IMPLEMENT**: Button listeners in `injectBar`:
  ```ts
  document.getElementById("tts-btn-play")?.addEventListener("click", () => {
    if (_isPlaying) {
      void pauseAudio();
    } else if (_isPaused) {
      void handleMessage({ type: "play" });
    } else {
      void playAudio();
    }
  });
  document.getElementById("tts-btn-stop")?.addEventListener("click", () => {
    void stopAudio();
  });
  ```

- **IMPLEMENT**: Auto-execution guard at BOTTOM of file:
  ```ts
  if (import.meta.env.MODE !== "test") {
    void init().catch(console.error);
  }
  ```

- **GOTCHA**: `browser.runtime.onMessage.addListener` expects the callback to return a `Promise` (or `true` for
  async response) — always return `Promise.resolve(...)`. Returning `void` causes the popup's `sendMessage` to
  reject.
- **GOTCHA**: `window.location.assign` in jsdom tests is read-only unless mocked. Use
  `vi.spyOn(window.location, "assign").mockImplementation(() => {})` in tests.
- **GOTCHA**: Module-level `_player`, `_writer`, etc. are shared across all tests since the module is cached.
  Reset them in `beforeEach` via `vi.resetModules()` + dynamic import, OR reset the mutable state by calling
  helper functions. See test file for the chosen approach.
- **GOTCHA**: `textContent` for injected HTML — NEVER use `innerHTML` with user-derived strings (story titles
  may contain angle brackets from some fiction sites).
- **VALIDATE**: `npx tsc --noEmit`
- **SATISFIES**: AC #1 (floating bar appears), AC #2 (play starts TTS), AC #3 (auto-advance), AC #4 (pause saves
  state), AC #5 (resume on reload), AC #6 (stop clears state)

---

### CREATE `src/content/index.test.ts`

Tests use `vi.resetModules()` + dynamic import per test to get a fresh module with fresh mutable state.

- **IMPLEMENT imports + mocks**:
  ```ts
  import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
  import { makeMockBrowser } from "../__fixtures__/mockBrowser";
  import { readFileSync } from "fs";
  import { resolve, dirname } from "path";
  import { fileURLToPath } from "url";

  const _dirname = dirname(fileURLToPath(import.meta.url));

  function loadFixture(name: string): string {
    return readFileSync(resolve(_dirname, "../__fixtures__", name), "utf-8");
  }

  // vi.mock calls are hoisted by Vitest — they run before imports and before each test
  vi.mock("./parser");
  vi.mock("./audioPlayer");
  vi.mock("./ttsEngine");
  vi.mock("./stateSync");
  ```

- **IMPLEMENT**: `beforeEach` / `afterEach`:
  ```ts
  let mockBrowser: ReturnType<typeof makeMockBrowser>;
  let mockPlayer: { play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>;
                    resume: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>;
                    currentCharOffset: ReturnType<typeof vi.fn> };
  let capturedOptions: import("./audioPlayer").AudioPlayerOptions | null;

  beforeEach(async () => {
    vi.resetModules(); // fresh module state each test

    mockBrowser = makeMockBrowser();
    vi.stubGlobal("browser", mockBrowser);
    vi.spyOn(window.location, "assign").mockImplementation(() => {});

    // AudioPlayer mock — capture options for triggering onExhausted/onError in tests
    capturedOptions = null;
    mockPlayer = {
      play: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(),
      currentCharOffset: vi.fn().mockReturnValue(0),
    };
    const { AudioPlayer } = await import("./audioPlayer");
    vi.mocked(AudioPlayer).mockImplementation((_doc, opts) => {
      capturedOptions = opts;
      return mockPlayer as unknown as import("./audioPlayer").AudioPlayer;
    });

    // ttsChunks mock — returns an empty async generator
    const { ttsChunks } = await import("./ttsEngine");
    vi.mocked(ttsChunks).mockReturnValue(
      (async function* () {})() as AsyncGenerator<import("./ttsEngine").TtsChunk>
    );

    // stateSync defaults
    const stateSync = await import("./stateSync");
    vi.mocked(stateSync.isThreadmarkPage ?? stateSync.saveStory).mockResolvedValue(undefined as never);
    vi.mocked(stateSync.loadStory).mockResolvedValue(null);
    vi.mocked(stateSync.loadPlaybackState).mockResolvedValue(null);
    vi.mocked(stateSync.saveStory).mockResolvedValue(undefined);
    vi.mocked(stateSync.savePlaybackState).mockResolvedValue(undefined);
    vi.mocked(stateSync.clearPlaybackState).mockResolvedValue(undefined);
    vi.mocked(stateSync.resolveResume).mockReturnValue({ type: "none" });
    vi.mocked(stateSync.loadPreferences).mockResolvedValue({ ttsSpeed: 1.0, volume: 1.0 });
    const MockWriter = vi.fn().mockReturnValue({
      enqueue: vi.fn(), flush: vi.fn().mockResolvedValue(undefined), destroy: vi.fn(),
    });
    vi.mocked(stateSync.ThrottledStateWriter).mockImplementation(MockWriter);

    // parser defaults
    const parser = await import("./parser");
    vi.mocked(parser.isThreadmarkPage).mockReturnValue(false);
    vi.mocked(parser.parseThreadmarkPage).mockReturnValue({
      storyId: "abc123", storyTitle: "Test Story", site: "sb",
      currentUrl: "https://forums.spacebattles.com/threads/test.123/reader/1/",
      threadmarkTitle: "Chapter 1", threadmarkIndex: 1,
      nextUrl: "https://forums.spacebattles.com/threads/test.123/reader/2/",
      prevUrl: null, bodyText: "Once upon a time.",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });
  ```

- **IMPLEMENT**: Helper to import + run init after mocks are configured:
  ```ts
  async function runInit(): Promise<void> {
    const { init } = await import("./index");
    await init();
    await new Promise<void>(r => setTimeout(r, 0)); // drain microtasks
  }
  ```

- **IMPLEMENT**: `describe("non-threadmark page")`:
  - `isThreadmarkPage` returns `false` → `init()` returns early → no bar in `document.body`, no `AudioPlayer`
    constructed

- **IMPLEMENT**: `describe("threadmark page — no saved state (resolveResume: none)")`:
  - Set `isThreadmarkPage → true`, `resolveResume → { type: "none" }`
  - After `init()`: `#threadmark-tts-bar` exists in DOM
  - `saveStory` was called with `{ id: "abc123", title: "Test Story", ... }`
  - `AudioPlayer` was constructed once
  - `player.play` was NOT called (no auto-play for "none")
  - `window.location.assign` was NOT called

- **IMPLEMENT**: `describe("threadmark page — resume-here")`:
  - Set `isThreadmarkPage → true`, `resolveResume → { type: "resume-here", charOffset: 0 }`
  - After `init()`: `player.play` was called with the mocked generator + `{ title, artist }` metadata
  - `savePlaybackState` was called with `{ currentThreadmarkUrl: currentUrl, charOffset: 0 }`

- **IMPLEMENT**: `describe("threadmark page — navigate")`:
  - Set `isThreadmarkPage → true`, `resolveResume → { type: "navigate", url: "https://...saved-url..." }`
  - After `init()`: `window.location.assign` called with `"https://...saved-url..."`
  - `#threadmark-tts-bar` NOT in DOM (navigation short-circuits before bar injection)

- **IMPLEMENT**: `describe("onExhausted — with nextUrl")`:
  - After `init()` with `resolveResume: none`, trigger `capturedOptions?.onExhausted()`
  - `savePlaybackState` called with `{ currentThreadmarkUrl: nextUrl, charOffset: 0 }`
  - `window.location.assign` called with `nextUrl`
  - `clearPlaybackState` NOT called

- **IMPLEMENT**: `describe("onExhausted — last chapter (no nextUrl)")`:
  - Set `parseThreadmarkPage` to return `{ ...defaults, nextUrl: null }`
  - After `init()`, trigger `capturedOptions?.onExhausted()`
  - `clearPlaybackState` called
  - `window.location.assign` NOT called

- **IMPLEMENT**: `describe("onError callback")`:
  - After `init()`, trigger `capturedOptions?.onError(new Error("TTS fetch failed: 429"))`
  - `#tts-error` element is visible and contains the error message substring

- **IMPLEMENT**: `describe("message: getState")`:
  - Capture the message listener from `browser.runtime.onMessage.addListener`
  - Call listener with `{ type: "getState" }`
  - Response includes `{ storyTitle: "Test Story", threadmarkTitle: "Chapter 1", isPlaying: false, ... }`

- **IMPLEMENT**: `describe("message: stop")`:
  - After init, call listener with `{ type: "stop" }`
  - `player.stop()` called
  - `clearPlaybackState` called

- **GOTCHA**: `vi.mocked(AudioPlayer)` requires that `AudioPlayer` was imported AFTER `vi.mock("./audioPlayer")`.
  With `vi.resetModules()` + dynamic import in `beforeEach`, re-import the mocked module each time.
- **GOTCHA**: `browser.runtime.onMessage.addListener` — the `makeMockBrowser` fixture doesn't include
  `runtime.onMessage`. Add it to the mock:
  ```ts
  // Extend makeMockBrowser result in beforeEach:
  let capturedMessageListener: ((msg: unknown) => Promise<unknown>) | null = null;
  mockBrowser = {
    ...makeMockBrowser(),
    runtime: {
      onMessage: {
        addListener: vi.fn((fn) => { capturedMessageListener = fn; }),
      },
    },
  };
  ```
- **VALIDATE**: `npm test -- index`
- **SATISFIES**: All AC above (automated coverage for the non-manual portions)

---

### REWRITE `src/popup/index.html`

- **IMPLEMENT**:
  ```html
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Threadmark TTS Reader</title>
    <style>
      body { font-family: sans-serif; width: 240px; padding: 12px; margin: 0; background: #1a1a2e; color: #e8e8e8; }
      #no-story { color: #888; font-size: 13px; padding: 8px 0; }
      #story-info { display: none; }
      #story-title { font-weight: bold; margin-bottom: 2px; font-size: 14px; }
      #chapter-title { color: #aaa; font-size: 11px; margin-bottom: 12px; }
      .controls { display: flex; gap: 8px; }
      .controls button {
        flex: 1; padding: 8px 4px; cursor: pointer; border: none; border-radius: 4px;
        background: #333; color: #e8e8e8; font-size: 14px;
      }
      .controls button:hover { background: #555; }
      #error-msg { color: #ff6b6b; font-size: 11px; margin-top: 8px; display: none; }
    </style>
  </head>
  <body>
    <div id="no-story">Open a SB / SV / QQ threadmark page to begin.</div>
    <div id="story-info">
      <div id="story-title"></div>
      <div id="chapter-title"></div>
      <div class="controls">
        <button id="btn-play">▶ Play</button>
        <button id="btn-stop">■ Stop</button>
      </div>
      <div id="error-msg"></div>
    </div>
    <script src="./index.ts" type="module"></script>
  </body>
  </html>
  ```
- **GOTCHA**: Use `textContent` (not `innerHTML`) when populating `#story-title` and `#chapter-title` in the TS.
- **VALIDATE**: `npm run build` — popup must appear as a separate Vite chunk
- **SATISFIES**: AC — minimal popup: story title + chapter + play/pause + stop

---

### REWRITE `src/popup/index.ts`

- **IMPLEMENT imports**:
  ```ts
  import type { ContentMessage, ContentState } from "../messages";
  ```

- **IMPLEMENT**: `export async function init(browserApi: typeof browser = browser): Promise<void>`
  (dependency injection makes it testable without stubbing the global)
  ```ts
  export async function init(browserApi: typeof browser = browser): Promise<void> {
    const [tab] = await browserApi.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    let state: ContentState | null = null;
    try {
      state = await browserApi.tabs.sendMessage(tab.id, { type: "getState" } satisfies ContentMessage) as ContentState;
    } catch {
      // Content script not present on this tab (not a threadmark page)
      return; // show the default "no-story" div, which is already visible
    }

    renderState(state);

    document.getElementById("btn-play")?.addEventListener("click", async () => {
      if (!tab.id) return;
      const msg: ContentMessage = state?.isPlaying ? { type: "pause" } : { type: "play" };
      try {
        await browserApi.tabs.sendMessage(tab.id, msg);
        // Optimistic UI update
        if (state) {
          state.isPlaying = !state.isPlaying;
          state.isPaused = !state.isPlaying;
          renderState(state);
        }
      } catch { /* tab navigated away */ }
    });

    document.getElementById("btn-stop")?.addEventListener("click", async () => {
      if (!tab.id) return;
      try {
        await browserApi.tabs.sendMessage(tab.id, { type: "stop" } satisfies ContentMessage);
        if (state) {
          state.isPlaying = false;
          state.isPaused = false;
          renderState(state);
        }
      } catch { /* tab navigated away */ }
    });
  }
  ```

- **IMPLEMENT**: `function renderState(state: ContentState): void`
  ```ts
  function renderState(state: ContentState): void {
    const noStory = document.getElementById("no-story");
    const storyInfo = document.getElementById("story-info");
    if (!noStory || !storyInfo) return;

    noStory.style.display = "none";
    storyInfo.style.display = "block";

    const titleEl = document.getElementById("story-title");
    const chapterEl = document.getElementById("chapter-title");
    const playBtn = document.getElementById("btn-play");
    const errorEl = document.getElementById("error-msg");

    if (titleEl) titleEl.textContent = state.storyTitle;
    if (chapterEl) chapterEl.textContent = state.threadmarkTitle;
    if (playBtn) playBtn.textContent = state.isPlaying ? "⏸ Pause" : "▶ Play";
    if (errorEl) {
      errorEl.style.display = state.errorMessage ? "block" : "none";
      errorEl.textContent = state.errorMessage ?? "";
    }
  }
  ```

- **IMPLEMENT**: Auto-run at bottom (same Vite guard):
  ```ts
  if (import.meta.env.MODE !== "test") {
    void init().catch(console.error);
  }
  ```
  Add `/// <reference types="vite/client" />` as FIRST LINE.

- **GOTCHA**: `browser.tabs.query` returns `browser.tabs.Tab[]`; use optional chaining on `tab.id` because
  `id` is `number | undefined` in the type (tabs in some states have no id).
- **GOTCHA**: `satisfies ContentMessage` is used instead of type assertion for better type checking.
- **VALIDATE**: `npx tsc --noEmit`
- **SATISFIES**: AC — popup communicates with content script via `browser.tabs.sendMessage`

---

### CREATE `src/popup/index.test.ts`

- **IMPLEMENT imports**:
  ```ts
  import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
  import { init } from "./index";
  import type { ContentState } from "../messages";
  ```

- **IMPLEMENT**: Mock browser and DOM setup:
  ```ts
  function mockBrowserApi(stateOverrides?: Partial<ContentState>) {
    const defaultState: ContentState = {
      storyTitle: "The Metropolitan Man", threadmarkTitle: "Chapter 1",
      isPlaying: false, isPaused: false, errorMessage: null, hasNextChapter: true,
    };
    const state = { ...defaultState, ...stateOverrides };
    return {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 42 }]),
        sendMessage: vi.fn().mockImplementation((tabId, msg) => {
          if (msg.type === "getState") return Promise.resolve(state);
          return Promise.resolve();
        }),
      },
    };
  }

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="no-story">Open a threadmark page.</div>
      <div id="story-info" style="display:none">
        <div id="story-title"></div>
        <div id="chapter-title"></div>
        <div class="controls">
          <button id="btn-play">▶ Play</button>
          <button id="btn-stop">■ Stop</button>
        </div>
        <div id="error-msg" style="display:none"></div>
      </div>
    `;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });
  ```

- **IMPLEMENT**: Test suites:

  **`describe("no active tab")`**:
  - `tabs.query` returns `[]` → init returns without throwing, `#no-story` still visible

  **`describe("content script not on tab (sendMessage rejects)")`**:
  - `tabs.sendMessage` rejects → `#no-story` still visible, `#story-info` still hidden

  **`describe("renders state from content script")`**:
  - After `init(mockBrowserApi())`: `#no-story` hidden, `#story-info` visible
  - `#story-title` textContent === `"The Metropolitan Man"`
  - `#chapter-title` textContent === `"Chapter 1"`
  - `#btn-play` textContent === `"▶ Play"` (not playing)

  **`describe("renders isPlaying state")`**:
  - With `stateOverrides: { isPlaying: true }`: `#btn-play` textContent === `"⏸ Pause"`

  **`describe("renders errorMessage")`**:
  - With `stateOverrides: { errorMessage: "TTS error — 429" }`:
    `#error-msg` is visible, textContent contains `"TTS error — 429"`

  **`describe("play button — stopped state → sends play")`**:
  - After init, click `#btn-play`
  - `tabs.sendMessage` called with `{ type: "play" }` (second call after the getState call)
  - Optimistic update: `#btn-play` textContent === `"⏸ Pause"`

  **`describe("play button — playing state → sends pause")`**:
  - With `stateOverrides: { isPlaying: true }`, click `#btn-play`
  - `tabs.sendMessage` called with `{ type: "pause" }`

  **`describe("stop button sends stop")`**:
  - Click `#btn-stop` → `tabs.sendMessage` called with `{ type: "stop" }`
  - Optimistic update: `#btn-play` textContent === `"▶ Play"`

- **GOTCHA**: The popup's `init(browserApi)` uses dependency injection — pass `mockBrowserApi()` directly.
  No `vi.stubGlobal` needed for browser.
- **VALIDATE**: `npm test -- popup`
- **SATISFIES**: AC — popup UI renders correctly, button handlers send correct messages

---

### REWRITE `src/background/index.ts`

- **IMPLEMENT**:
  ```ts
  import { loadPreferences, savePreferences } from "../content/stateSync";

  browser.runtime.onInstalled.addListener(async () => {
    // Ensure default preferences exist in sync storage
    const prefs = await loadPreferences();
    await savePreferences(prefs); // writes defaults if nothing saved yet
  });
  ```
- **GOTCHA**: `loadPreferences` already merges with `DEFAULT_PREFS`, so calling `savePreferences(prefs)` after
  `loadPreferences()` is idempotent — it writes the defaults if they don't exist, no-ops otherwise.
- **GOTCHA**: Background page imports from `"../content/stateSync"` — this is a relative path from
  `src/background/index.ts`. Confirm the path resolves to `src/content/stateSync.ts`.
- **VALIDATE**: `npm run build` — background bundle must compile clean
- **SATISFIES**: AC — extension initialises on install without errors

---

### VALIDATE `src/content/index.test.ts` — extend `makeMockBrowser` to include `runtime.onMessage`

The existing `makeMockBrowser` fixture (`src/__fixtures__/mockBrowser.ts`) doesn't include
`browser.runtime.onMessage`. Rather than modifying the shared fixture (which could affect TICKET-2/3 tests),
**extend it locally** in the content-script test:

```ts
// In beforeEach of src/content/index.test.ts:
let capturedMessageListener: ((msg: unknown) => Promise<unknown>) | null = null;
const baseMock = makeMockBrowser();
vi.stubGlobal("browser", {
  ...baseMock,
  runtime: {
    onMessage: {
      addListener: vi.fn((fn: (msg: unknown) => Promise<unknown>) => {
        capturedMessageListener = fn;
      }),
    },
  },
});
```

This keeps the shared fixture untouched and adds only what the orchestrator tests need.

- **VALIDATE**: `npm test` — all tests pass (85 existing + new content/index + popup tests)

---

### VALIDATE full suite + build

- **VALIDATE**: `npm test` — all 85 existing tests + new tests pass, zero failures
- **VALIDATE**: `npx tsc --noEmit` — zero type errors
- **VALIDATE**: `npm run build` — clean build: background, content, and popup bundles all present in `dist/`
- **SATISFIES**: No regressions in existing functionality

---

## TESTING STRATEGY

### Unit Tests

**Vitest 4 + jsdom** (same as all prior tickets). No new test config needed.

**`src/content/index.test.ts`** — orchestrator tests use `vi.resetModules()` + dynamic import to get a fresh
module instance per test (avoids shared mutable state between tests). All dependencies mocked via `vi.mock()`.
The content script's `import.meta.env.MODE !== "test"` guard prevents auto-execution; tests call `init()`
explicitly.

**`src/popup/index.test.ts`** — popup uses dependency injection (`init(browserApi)`), so tests pass a mock
`browserApi` directly. DOM is set up in `beforeEach` to mirror the popup HTML structure.

### Integration Tests

Not in scope. The ticket's primary acceptance test is manual (see VALIDATION COMMANDS §Level 4).

### Edge Cases

**Content script:**
- Non-threadmark page (isThreadmarkPage returns false) → silent early exit
- `parseThreadmarkPage` throws → error should be caught and logged (not crash the page)
- `resolveResume` returns `"navigate"` → window.location.assign, NO bar injection
- `onExhausted` with `nextUrl: null` (last chapter) → `clearPlaybackState` called, no navigation
- `onExhausted` with `nextUrl` → save state, navigate
- `onError` callback → error visible in bar, player state reset
- `stop()` called while already stopped → no-op, no double `clearPlaybackState`
- `beforeunload` → `writer.destroy()` called (timer cancelled, no pending write lost)

**Popup:**
- Active tab with no `id` (background tab) → init returns early
- `sendMessage` rejects (not a threadmark page) → `#no-story` visible
- Play button click when `isPlaying: true` → sends `{ type: "pause" }`
- Stop button when already stopped → sends `{ type: "stop" }` (no-op in content script, harmless)

---

## VALIDATION COMMANDS

### Level 1: Type check
```bash
npx tsc --noEmit
```

### Level 2: Unit tests (all)
```bash
npm test
```
Expected: 85 existing + new tests pass, zero failures.

### Level 3: Unit tests (new files only)
```bash
npm test -- index
npm test -- popup
```

### Level 4: Build
```bash
npm run build
```
Verify `dist/` contains background, content, and popup entry points.

### Level 5: Manual end-to-end (primary acceptance test)

Load the extension in Firefox desktop (`web-ext run` or load as temporary add-on from `dist/`):

1. Open a SB/SV/QQ threadmark page → floating bar appears bottom-right with story + chapter name
2. Click ▶ (or open popup, click Play) → TTS starts reading aloud
3. Wait for chapter to finish → next chapter URL loads, TTS continues automatically (no touch required)
4. Click ⏸ → audio pauses; reload the tab → TTS resumes from the same chapter automatically
5. Click ■ → audio stops; reload the tab → bar appears but does NOT auto-play (state was cleared)
6. On Firefox for Android: background the app while playing → verify audio continues (or at least resumes
   correctly on foreground — the Media Session API spike validated desktop; Android requires a live device test)

---

## ACCEPTANCE CRITERIA

- [ ] Open a SB/SV/QQ threadmark page → `#threadmark-tts-bar` appears, shows story + chapter title
- [ ] Click play → TTS starts reading the current chapter from the beginning
- [ ] Chapter ends → next chapter URL loads automatically, TTS continues without screen interaction (AC #3)
- [ ] Click pause → audio stops; browser.storage.local updated with current threadmark URL
- [ ] Reload/reopen the tab → TTS auto-resumes from the saved threadmark (AC #5)
- [ ] Click stop → audio stops; stored playback state cleared; reloading the page does NOT auto-play
- [ ] Popup shows story title, chapter name, play/pause toggle button, stop button
- [ ] Popup play/pause button toggles correctly; stop button sends stop
- [ ] On a non-threadmark page: extension is silent (no bar injected, no errors)
- [ ] On last chapter: TTS stops after final chunk, state cleared, no navigation
- [ ] TTS error (fetch fails after retries): error message visible in bar; not a silent stop
- [ ] `npm test` passes with zero failures (all existing 85 tests + new tests)
- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] `npm run build` produces clean `dist/` with all three entry bundles

---

## COMPLETION CHECKLIST

- [ ] `src/messages.ts` created
- [ ] `src/content/index.ts` rewritten (exports `init()`, auto-execute guard, all orchestration logic)
- [ ] `src/content/index.test.ts` created, all tests pass
- [ ] `src/popup/index.html` rewritten (full popup HTML)
- [ ] `src/popup/index.ts` rewritten (DI-friendly `init(browserApi?)`, renderState, button handlers)
- [ ] `src/popup/index.test.ts` created, all tests pass
- [ ] `src/background/index.ts` rewritten (preferences init on install)
- [ ] `npm test` — all tests pass
- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npm run build` — clean build
- [ ] Manual E2E steps 1–5 verified (desktop Firefox)

---

## OPEN QUESTIONS / ASSUMPTIONS

**Assumed — auto-play on `"resume-here"`**: The orchestrator auto-plays immediately when `resolveResume` returns
`"resume-here"` (no "tap to resume" prompt). This matches the PRD's "hands-free" promise and AC #5 ("audio
resumes"). If the user wants to NOT auto-play on resume, a preferences toggle would be needed (post-MVP).

**Assumed — auto-navigate on `"navigate"` without prompt**: If the user opens chapter 1 of a story they were on
chapter 50, the extension navigates to chapter 50 automatically. This is the correct behavior for a resume-focused
tool, but could surprise a user trying to re-read from chapter 1. Clearing state (via stop) before navigating
away from chapter 50 would prevent this. If unwanted, a "resume from saved chapter?" confirmation dialog is a
post-MVP UX decision.

**Assumed — resume granularity is threadmark-level for MVP**: `charOffset` in `PlaybackState` is written but not
used to skip ahead within a chapter's TTS chunks. Resume always starts from the beginning of the saved
threadmark. Within-chapter precision is a post-MVP enhancement.

**Assumed — preferences (ttsSpeed, volume) not wired to AudioPlayer in this ticket**: `loadPreferences()` is
called in `playAudio()` to establish the pattern, but `prefs.ttsSpeed` is not applied to `audio.playbackRate`
and `prefs.volume` is not applied to `audio.volume`. The `AudioPlayer` class doesn't currently expose the
`<audio>` element — wiring this requires a minor AudioPlayer update (add `setPlaybackRate(rate)` and
`setVolume(vol)` methods). Defer to a post-TICKET-4 follow-up.

**Open — CSP + blob URLs on SB/SV/QQ**: If site CSP blocks `blob:` URLs in content script `<audio>` elements,
the TTS pipeline will silently fail (the audio element won't load). The `onError` callback will fire. Fallback
(ArrayBuffer + Web Audio API) is explicitly out of scope. Validate during manual E2E in Level 5.

**Open — Firefox for Android backgrounding**: The Media Session API integration was validated on desktop during
the architecture spike. Real-device Android validation is the first acceptance check after TICKET-4 ships. If
audio dies on backgrounding, the architecture doc's spike decision tree applies.

**Assumed — `browser.runtime.onMessage.addListener` callback receives the full message object**: The `(msg:
unknown)` cast is safe here because the popup always sends typed `ContentMessage` objects. If a third-party
content script or devtools sends an unexpected message shape, the `switch` in `handleMessage` falls through
silently (no default case needed — TypeScript exhaustiveness ensures it's unreachable with typed input).

---

## NOTES

### Why dependency injection on `popup/index.ts` `init()` instead of `vi.stubGlobal("browser", ...)`

The popup is tiny and its entire logic flows through `browserApi`. Passing the mock directly (`init(mockBrowserApi())`) is simpler and more explicit than global stubbing — the test reader can see exactly what the popup interacts with. The content script uses global stubbing because its dependencies are module-level (parser, audioPlayer, etc.) rather than a single injectable object.

### Mutable module-level state in `content/index.ts`

The orchestrator holds `_player`, `_writer`, `_page`, and playback flags as module-level variables (not a class). This is intentional: there's one content script per tab and no need for multiple instances. The module-level state is effectively a singleton. Tests use `vi.resetModules()` to get a fresh singleton per test, which is the standard Vitest pattern for modules with state.

### `satisfies` vs `as` for message type assertions

The plan uses `satisfies ContentMessage` (not `as ContentMessage`) in the popup to get type-checked assignments rather than casts. If the TypeScript version doesn't support `satisfies`, fall back to an explicit typed variable:
```ts
const msg: ContentMessage = { type: "play" };
await browserApi.tabs.sendMessage(tab.id, msg);
```

### Why not pre-fetch the next chapter's audio during current playback

This is listed as "post-MVP" in both the TICKET-2 plan and the PRD. The current `ttsChunks` generator only accepts a single text string; pre-fetching would require starting a second generator for the next chapter's text and holding the resulting blob URLs in memory. The `<audio>` element approach also doesn't easily support queueing from two different sources. Defer.

### Background page import path

`src/background/index.ts` imports `loadPreferences` and `savePreferences` from `"../content/stateSync"`. Vite
resolves this relative to the file, so the path is `src/content/stateSync.ts`. The background bundle will include
a copy of stateSync — acceptable since there are no external runtime dependencies and bundle size is not a
concern for MVP.

---

## AMENDMENTS

*(none yet)*
