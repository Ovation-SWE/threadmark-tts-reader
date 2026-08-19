# Implementation Report — TICKET-4: Content Script Orchestration + Popup UI + Background Page

**Plan**: `.claude/plans/ticket-4-orchestration-popup-ui.md`   **Branch**: `feature/ticket-4-orchestration-popup-ui`   **Status**: COMPLETE

## Summary

Wired the four previously-implemented modules (parser, ttsEngine, audioPlayer, stateSync) into a working extension. The content script (`src/content/index.ts`) is now the primary orchestrator: it parses the current page, resolves saved playback state, injects a floating control bar, drives the audio pipeline, persists progress, and auto-advances to the next chapter when a chapter ends. A minimal popup (`src/popup/index.ts`) shows story/chapter info and play/pause/stop controls that message the content script via `browser.tabs.sendMessage`. The background page initialises default preferences on install. A shared `src/messages.ts` module defines the message and state types used by both sides.

## Tasks completed

- `src/messages.ts` → CREATE (shared `ContentMessage` union + `ContentState` interface)
- `src/content/index.ts` → REWRITE (full orchestrator: bar injection, audio lifecycle, message handler, auto-advance)
- `src/content/index.test.ts` → CREATE (15 tests covering all orchestrator behaviours)
- `src/popup/index.html` → REWRITE (full popup HTML with dark-theme styling)
- `src/popup/index.ts` → REWRITE (DI-friendly `init(browserApi?)`, `renderState`, button handlers)
- `src/popup/index.test.ts` → CREATE (11 tests covering all popup states and interactions)
- `src/background/index.ts` → REWRITE (preferences init on install)

## Tests added

- `src/content/index.test.ts` — 15 tests:
  - Non-threadmark page: early exit, no bar, no AudioPlayer
  - Threadmark page (resolveResume: none): bar injection, saveStory call, AudioPlayer construction, no auto-play, no navigation
  - Threadmark page (resume-here): auto-play, savePlaybackState called
  - Threadmark page (navigate): location.assign called, no bar injected
  - onExhausted with nextUrl: savePlaybackState + navigate to next chapter
  - onExhausted last chapter: clearPlaybackState, no navigation
  - onError callback: error visible in bar
  - message getState: returns current state
  - message stop: player.stop + clearPlaybackState

- `src/popup/index.test.ts` — 11 tests:
  - No active tab: no-story remains visible
  - sendMessage rejects: no-story visible, story-info hidden
  - Renders state: no-story hidden, story-info visible, titles + play button correct
  - isPlaying state: pause button shown
  - errorMessage: error element visible with message
  - Play button (stopped): sends play, optimistic update to pause
  - Play button (playing): sends pause
  - Stop button: sends stop, reverts button to play

All 111 tests pass (85 existing + 26 new).

## Validation results

- `npx tsc --noEmit` → ✅ zero errors
- `npm test` → ✅ 111 passed, 0 failed, 6 test files
- `npm run build` → ✅ clean build:
  - `dist/src/popup/index.html` (1.34 kB)
  - `dist/src/popup/index.js` (1.83 kB)
  - `dist/src/background/index.js` (0.29 kB)
  - `dist/src/content/index.js` (10.41 kB)

## Deviations from the plan

1. **`vi.clearAllMocks()` added alongside `vi.resetModules()`** in content script test `beforeEach`. The plan used only `vi.resetModules()`, but Vitest 4's auto-mock system does not reset vi.fn() call counts on module cache reset alone — the same vi.fn() instances are reused across tests. Adding `vi.clearAllMocks()` ensures clean call counts per test.

2. **`AudioPlayer` mock uses `function` keyword, not arrow function**. Vitest 4 rejects arrow functions as constructor implementations (`new Cls()`). The mock uses `function(_doc: Document, opts: AudioPlayerOptions) { ... }` to work with `new`. The plan's sample code used an arrow function which would have thrown at runtime.

3. **`ThrottledStateWriter` mock uses `class` syntax**. Vitest 4 also rejects `mockReturnValue` when the mock is called with `new`. The mock uses an inline `class` with method fields instead. Plan's sample used `vi.fn().mockReturnValue({...})`.

4. **`window.location.assign` mocked via `vi.stubGlobal("location", {...})`**. In jsdom 30, `window.location.assign` is non-configurable, so `vi.spyOn(window.location, "assign")` throws. The solution replaces the entire `window.location` stub with `vi.stubGlobal("location", { href: "http://localhost/", assign: vi.fn() })`. Tests reference `mockAssign` directly instead of `window.location.assign`.

## Issues encountered

None beyond the Vitest 4 class mock compatibility differences documented as deviations above. All issues were resolved during implementation.
