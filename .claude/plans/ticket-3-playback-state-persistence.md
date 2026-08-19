# Feature: TICKET-3 — Playback State Persistence + Resume

The following plan should be complete, but validate documentation and codebase patterns before implementing.
Pay special attention to naming of existing types and the storage key conventions established here.

---

## Feature Description

Implement `src/content/stateSync.ts` — the storage layer for the Threadmark TTS Reader extension.
It persists `Story` and `PlaybackState` entities to `browser.storage.local`, provides throttled
write-during-playback with forced-flush on pause/stop, and resolves a resume action (none / resume
here / navigate) when the content script initialises on a threadmark page. Also defines the
`UserPreferences` schema in `browser.storage.sync` (no UI yet).

## User Story

As a listener mid-story,
I want the extension to remember exactly where I stopped playing,
so that I can close Firefox, reopen it later, and resume from the right chapter automatically.

## Problem Statement

Without persistence, closing or reloading any tab resets playback to the beginning. Because
threadmark stories span hundreds of chapters, losing position is a hard block on the core
"hands-free" promise.

## Solution Statement

A pure storage module (`stateSync.ts`) that:
1. Upserts `Story` and `PlaybackState` records to `browser.storage.local` (keyed by storyId).
2. Exposes a `ThrottledStateWriter` class that rate-limits progress writes to ≤1 per 5 seconds
   while allowing immediate flushes on pause/stop.
3. Provides a pure `resolveResume` function the orchestrator calls at page load to decide whether
   to continue here, restart at a different URL, or start fresh.
4. Defines `UserPreferences` in `browser.storage.sync` with load/save helpers and sane defaults.

## Out of Scope / Non-Goals

- Not included: history, favorites, crosspost clustering (post-MVP).
- Not included: any UI wiring for preferences — schema only.
- Not included: `window.location.assign()` or any navigation — stateSync returns an action; the
  orchestrator (TICKET-4) acts on it.
- Not changing: `parser.ts`, fixtures, `background/index.ts` stub.
- Not included: IndexedDB — `browser.storage.local` is sufficient for MVP.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium
**Primary Systems Affected**: `src/content/stateSync.ts`, `src/types.ts`
**Dependencies**: `browser.storage.local`, `browser.storage.sync` (WebExtension API — mocked in tests)

## Related Work

**Implements**: TICKET-3 (`docs/tickets/threadmark-tts-reader.md`)
**Epic**: `threadmark-tts-reader.arch.md` (Data Model section)

**Back-references**:
- `.claude/reports/ticket-1-scaffold-parser-report.md` — establishes build scaffold, types, and the `Site` type this plan imports
- `src/content/parser.ts` — exports `Site` and `ThreadmarkPage`; `stateSync.ts` imports `Site`

**Forward-references**:
- TICKET-2 (`audioPlayer.ts`) — will call `ThrottledStateWriter.enqueue()` during chunk playback
- TICKET-4 (`content/index.ts`) — will call `resolveResume`, `saveStory`, `flush`, `clearPlaybackState`

---

## CONTEXT REFERENCES

### Relevant Codebase Files — MUST READ BEFORE IMPLEMENTING

- `src/content/parser.ts` (lines 11–23) — `Site` type and `ThreadmarkPage` interface to import; do NOT redefine `Site`
- `src/content/parser.test.ts` (lines 1–10) — test file header: import style (explicit from `"vitest"`), `readFileSync`/`fileURLToPath` pattern, no top-level beforeEach
- `vitest.config.ts` — `environment: "jsdom"`, `globals: true`; tests still import from `"vitest"` explicitly (follow parser.test.ts)
- `tsconfig.json` — `"types": ["firefox-webext-browser"]`; browser extension globals are in scope
- `tsconfig.test.json` — extends main, adds `"node"` and `"vitest/globals"`

### New Files to Create

- `src/types.ts` — `Story`, `PlaybackState`, `UserPreferences`, `ResumeAction` (shared across all modules)
- `src/content/stateSync.ts` — storage functions + `ThrottledStateWriter` class
- `src/content/stateSync.test.ts` — unit tests (round-trips, throttle, resume logic, preferences)
- `src/__fixtures__/mockBrowser.ts` — reusable in-memory `browser.storage` stub (used by TICKET-2 and TICKET-4 tests too)

### Relevant Documentation — READ BEFORE IMPLEMENTING

- `threadmark-tts-reader.arch.md` §Data Model — canonical field names and types for `Story`, `PlaybackState`, storage limits
- `docs/tickets/threadmark-tts-reader.md` §TICKET-3 — acceptance criteria, throttle spec, resume behaviour

### Patterns to Follow

**Import style (from parser.test.ts:1):**
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
```
Use explicit vitest imports even though globals are enabled.

**Type exports (from parser.ts:11):**
```ts
export type Site = "sb" | "sv" | "qq";
export interface ThreadmarkPage { ... }
```
Types and interfaces at the top of the file, exported inline.

**Narrow error messages (from parser.ts:154):**
```ts
throw new Error(`Unsupported site: ${hostname}`);
```
Errors surface the offending value; no silent nulls on storage failures.

**Storage key convention (new for this ticket):**
```ts
const STORY_KEY = (id: string) => `story:${id}`;
const PLAYBACK_KEY = (id: string) => `playback:${id}`;
const PREFS_KEY = "prefs";
```

**No external npm dependencies** — the architecture forbids runtime dependencies beyond WebExtension polyfill.

---

## IMPLEMENTATION PLAN

### Phase 1: Shared types (`src/types.ts`)

**Independent of Phase 2** — can be written first; Phase 2 imports from it.

Define the four shared types that TICKET-2, TICKET-3, and TICKET-4 all need. Import `Site` from
`parser.ts`; do not redefine it.

**Tasks:**
- CREATE `src/types.ts` with `Story`, `PlaybackState`, `UserPreferences`, `ResumeAction`

### Phase 2: Storage module (`src/content/stateSync.ts`)

**Depends on:** Phase 1 (imports from `src/types.ts` and `src/content/parser.ts`)

Implement the storage functions and `ThrottledStateWriter`. No UI, no navigation.

**Tasks:**
- Implement storage key helpers (private constants, not exported)
- Implement `saveStory` / `loadStory`
- Implement `savePlaybackState` / `loadPlaybackState` / `clearPlaybackState`
- Implement `resolveResume` (pure function — no I/O)
- Implement `ThrottledStateWriter` class
- Implement `loadPreferences` / `savePreferences`

### Phase 3: Test infrastructure + tests

**Depends on:** Phase 2 (tests exercise the real implementation)

Create the shared browser mock first, then write all test cases.

**Tasks:**
- CREATE `src/__fixtures__/mockBrowser.ts`
- CREATE `src/content/stateSync.test.ts`

---

## STEP-BY-STEP TASKS

### CREATE `src/types.ts`

- **IMPLEMENT**: Four exported types. Import `Site` from `"./content/parser"`.
  ```ts
  import type { Site } from "./content/parser";

  export interface Story {
    id: string;
    title: string;
    site: Site;
    firstThreadmarkUrl: string;
    lastSeenAt: number;          // Date.now() timestamp
  }

  export interface PlaybackState {
    storyId: string;
    currentThreadmarkUrl: string;
    charOffset: number;           // character position within threadmark body text
    updatedAt: number;            // Date.now() timestamp
  }

  export interface UserPreferences {
    ttsSpeed: number;             // 0.5–2.0; default 1.0
    volume: number;               // 0.0–1.0; default 1.0
  }

  export type ResumeAction =
    | { type: "none" }
    | { type: "resume-here"; charOffset: number }
    | { type: "navigate"; url: string };
  ```
- **GOTCHA**: `import type` keeps the import erased at runtime — required since `parser.ts` will be a content-script module with no side-effect exports needed here.
- **VALIDATE**: `npx tsc --noEmit`
- **SATISFIES**: Foundation for all three TICKET-3 data types

---

### CREATE `src/__fixtures__/mockBrowser.ts`

- **IMPLEMENT**: A factory function returning an in-memory `browser` stub. Must cover `storage.local.get`, `storage.local.set`, `storage.local.remove`, `storage.sync.get`, `storage.sync.set`. Each call returns a resolved Promise. The `get(key)` pattern used in stateSync is single-key string — mock must handle that shape.
  ```ts
  export function makeMockBrowser() {
    const local: Record<string, unknown> = {};
    const sync: Record<string, unknown> = {};

    return {
      storage: {
        local: {
          get: (key: string) => Promise.resolve({ [key]: local[key] }),
          set: (items: Record<string, unknown>) => {
            Object.assign(local, items);
            return Promise.resolve();
          },
          remove: (key: string) => {
            delete local[key];
            return Promise.resolve();
          },
        },
        sync: {
          get: (key: string) => Promise.resolve({ [key]: sync[key] }),
          set: (items: Record<string, unknown>) => {
            Object.assign(sync, items);
            return Promise.resolve();
          },
        },
      },
    };
  }
  ```
- **GOTCHA**: Each test that uses this mock must call `vi.stubGlobal("browser", makeMockBrowser())` in `beforeEach` and `vi.unstubAllGlobals()` in `afterEach`. Using a fresh instance per test ensures no state bleed between tests.
- **VALIDATE**: File compiles (`npx tsc --noEmit` with `tsconfig.test.json`)
- **SATISFIES**: Shared mock reused by TICKET-2 and TICKET-4 test files

---

### CREATE `src/content/stateSync.ts`

#### Storage key helpers (top of file, not exported)

```ts
const STORY_KEY = (id: string) => `story:${id}`;
const PLAYBACK_KEY = (id: string) => `playback:${id}`;
const PREFS_KEY = "prefs";
const DEFAULT_PREFS: UserPreferences = { ttsSpeed: 1.0, volume: 1.0 };
const THROTTLE_MS = 5_000;
```

#### `saveStory` / `loadStory`

- **IMPLEMENT**:
  ```ts
  export async function saveStory(story: Story): Promise<void> {
    await browser.storage.local.set({ [STORY_KEY(story.id)]: story });
  }

  export async function loadStory(storyId: string): Promise<Story | null> {
    const result = await browser.storage.local.get(STORY_KEY(storyId));
    return (result[STORY_KEY(storyId)] as Story) ?? null;
  }
  ```
- **GOTCHA**: `browser.storage.local.get(key)` returns `{ [key]: value }` — always index into result by the exact key string, not by a variable that may shadow it.
- **VALIDATE**: `npm test -- --reporter=verbose`
- **SATISFIES**: AC — write/read round-trip for Story

#### `savePlaybackState` / `loadPlaybackState` / `clearPlaybackState`

- **IMPLEMENT**:
  ```ts
  export async function savePlaybackState(state: PlaybackState): Promise<void> {
    await browser.storage.local.set({ [PLAYBACK_KEY(state.storyId)]: state });
  }

  export async function loadPlaybackState(storyId: string): Promise<PlaybackState | null> {
    const result = await browser.storage.local.get(PLAYBACK_KEY(storyId));
    return (result[PLAYBACK_KEY(storyId)] as PlaybackState) ?? null;
  }

  export async function clearPlaybackState(storyId: string): Promise<void> {
    await browser.storage.local.remove(PLAYBACK_KEY(storyId));
  }
  ```
- **SATISFIES**: AC — write/read round-trip for PlaybackState; clearPlaybackState removes state

#### `resolveResume` — pure function, no I/O

- **IMPLEMENT**:
  ```ts
  export function resolveResume(
    currentUrl: string,
    state: PlaybackState | null
  ): ResumeAction {
    if (!state) return { type: "none" };
    if (state.currentThreadmarkUrl === currentUrl) {
      return { type: "resume-here", charOffset: state.charOffset };
    }
    return { type: "navigate", url: state.currentThreadmarkUrl };
  }
  ```
- **GOTCHA**: URL comparison is exact string equality — no normalisation. The orchestrator must pass `window.location.href` (or the parser's `currentUrl`) without modification.
- **SATISFIES**: AC — resume-on-same-page returns charOffset; resume-on-different-page returns navigate url; no state returns none

#### `ThrottledStateWriter` class

- **IMPLEMENT**: Hybrid leading/trailing throttle. On `enqueue`:
  - If ≥ `intervalMs` has elapsed since the last write, write immediately.
  - Otherwise, schedule a trailing write at the end of the current interval window (cancel any existing timer and replace with the latest state).
  - This ensures writes fire at most once per `intervalMs` during sustained activity, but trailing state is never silently dropped.
  
  `flush()` cancels any pending timer and writes the pending state immediately — used on pause/stop.
  `destroy()` cancels the timer and discards pending state without writing — used on page unload.

  ```ts
  export class ThrottledStateWriter {
    private readonly intervalMs: number;
    private lastWriteAt = 0;
    private pending: PlaybackState | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(intervalMs = THROTTLE_MS) {
      this.intervalMs = intervalMs;
    }

    enqueue(state: PlaybackState): void {
      this.pending = state;
      const elapsed = Date.now() - this.lastWriteAt;

      if (elapsed >= this.intervalMs) {
        this.writeNow();
      } else if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.writeNow();
        }, this.intervalMs - elapsed);
      }
      // else: timer already running; pending updated above — it will write on fire
    }

    async flush(): Promise<void> {
      if (this.timer !== null) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      if (this.pending) {
        const state = this.pending;
        this.pending = null;
        this.lastWriteAt = Date.now();
        await savePlaybackState(state);
      }
    }

    destroy(): void {
      if (this.timer !== null) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.pending = null;
    }

    private writeNow(): void {
      if (!this.pending) return;
      const state = this.pending;
      this.pending = null;
      this.lastWriteAt = Date.now();
      savePlaybackState(state); // fire-and-forget; errors non-critical during playback
    }
  }
  ```
- **GOTCHA**: `writeNow` is fire-and-forget (no await) intentionally — blocking `enqueue` on a storage write would stall the audio pipeline. Storage errors during playback are logged but not fatal. `flush` is async because pause/stop can afford to await.
- **VALIDATE**: `npm test -- --reporter=verbose`
- **SATISFIES**: AC — throttle behaviour (≤1 write per 5s during playback; always on pause/stop via flush)

#### `loadPreferences` / `savePreferences`

- **IMPLEMENT**:
  ```ts
  export async function loadPreferences(): Promise<UserPreferences> {
    const result = await browser.storage.sync.get(PREFS_KEY);
    const saved = result[PREFS_KEY] as Partial<UserPreferences> | undefined;
    return { ...DEFAULT_PREFS, ...saved };
  }

  export async function savePreferences(prefs: Partial<UserPreferences>): Promise<void> {
    const current = await loadPreferences();
    await browser.storage.sync.set({ [PREFS_KEY]: { ...current, ...prefs } });
  }
  ```
- **GOTCHA**: `browser.storage.sync` is used (not local) — preferences sync across devices. The 100 KB limit is ample for a single small object.
- **SATISFIES**: AC — preferences schema with defaults; round-trip via sync storage

---

### CREATE `src/content/stateSync.test.ts`

Cover every acceptance criterion. Use `vi.useFakeTimers()` for throttle tests so they don't
actually wait 5 seconds.

- **IMPLEMENT** the following test suites:

  **Suite: saveStory / loadStory round-trip**
  - saves a Story and loads it back with all fields intact
  - returns null for an unknown storyId

  **Suite: savePlaybackState / loadPlaybackState round-trip**
  - saves a PlaybackState and loads it back with all fields intact
  - returns null for an unknown storyId

  **Suite: clearPlaybackState**
  - state exists → after clear, loadPlaybackState returns null
  - calling clear on a non-existent key does not throw

  **Suite: resolveResume**
  - state is null → `{ type: "none" }`
  - state.currentThreadmarkUrl === currentUrl → `{ type: "resume-here", charOffset: N }`
  - state.currentThreadmarkUrl !== currentUrl → `{ type: "navigate", url: state.currentThreadmarkUrl }`

  **Suite: ThrottledStateWriter — throttle behaviour** (uses `vi.useFakeTimers()`)
  - first enqueue calls savePlaybackState immediately (leading edge)
  - second enqueue within 5s does NOT call savePlaybackState again immediately
  - after `vi.advanceTimersByTime(5000)`, the second (pending) state IS written
  - three rapid enqueues → only the last pending value is written at the trailing edge
  - `flush()` cancels the pending timer and writes pending state immediately
  - `flush()` with no pending state resolves without error
  - `destroy()` cancels the timer; subsequent flush resolves without writing

  **Suite: loadPreferences / savePreferences**
  - loadPreferences returns DEFAULT_PREFS when nothing saved
  - savePreferences({ ttsSpeed: 1.5 }) + loadPreferences → returns merged result with updated ttsSpeed and default volume
  - partial updates do not overwrite unrelated fields

- **PATTERN**: Test file header mirrors `parser.test.ts:1-6` (explicit imports, `beforeEach`/`afterEach` for mock setup/teardown)
- **GOTCHA**: `vi.useFakeTimers()` must be called in `beforeEach` and `vi.useRealTimers()` in `afterEach` for throttle tests only — scope it to the throttle suite to avoid breaking async storage tests that rely on real microtask timing.
- **GOTCHA**: `vi.stubGlobal("browser", makeMockBrowser())` before each test; `vi.unstubAllGlobals()` after. Each test gets a fresh in-memory store.
- **VALIDATE**: `npm test -- --reporter=verbose`
- **SATISFIES**: All acceptance criteria

---

## TESTING STRATEGY

### Unit Tests

All tests are unit tests (no real browser storage, no network). `browser.storage` is fully mocked
via `vi.stubGlobal`. Timer-dependent tests use `vi.useFakeTimers()`.

### Integration Tests

Not in scope for this ticket. Integration of stateSync with the orchestrator is validated as part
of TICKET-4's end-to-end acceptance test.

### Edge Cases

- `loadStory` / `loadPlaybackState` on a key that was never written → must return `null` (not throw, not return `undefined`)
- `clearPlaybackState` on a key that doesn't exist → must not throw
- `ThrottledStateWriter.flush()` with no pending state → must resolve cleanly (no-op)
- `ThrottledStateWriter.destroy()` followed by `flush()` → must be a no-op (no write)
- `savePreferences({})` with empty partial → must not corrupt existing preferences
- `resolveResume` with a state whose URL is an empty string → treated as "navigate" (non-equal to any real URL)

---

## VALIDATION COMMANDS

### Level 1: Type check

```bash
npx tsc --noEmit
```

### Level 2: Unit tests

```bash
npm test
```

Expected: all existing 29 parser tests still pass + all new stateSync tests pass.

### Level 3: Verbose test output (confirm new tests run)

```bash
npm test -- --reporter=verbose
```

### Level 4: Build check

```bash
npm run build
```

`src/types.ts` is not a content-script entry point — confirm it doesn't appear as a separate
bundle entry. It should only be imported by other modules.

---

## ACCEPTANCE CRITERIA

- [ ] `src/types.ts` defines `Story`, `PlaybackState`, `UserPreferences`, `ResumeAction` — imported from `parser.ts` for `Site`
- [ ] `saveStory` / `loadStory` round-trip in `browser.storage.local` — keyed `story:{id}`
- [ ] `savePlaybackState` / `loadPlaybackState` / `clearPlaybackState` round-trip — keyed `playback:{storyId}`
- [ ] `resolveResume` pure function: null state → `"none"`; URL match → `"resume-here"`; URL mismatch → `"navigate"`
- [ ] `ThrottledStateWriter` writes at most once per 5 seconds during rapid enqueues
- [ ] `ThrottledStateWriter.flush()` writes pending state immediately (called on pause/stop)
- [ ] `ThrottledStateWriter.destroy()` cancels timer without writing (called on page unload)
- [ ] `loadPreferences` returns `{ ttsSpeed: 1.0, volume: 1.0 }` defaults when storage is empty
- [ ] `savePreferences` / `loadPreferences` round-trip via `browser.storage.sync`
- [ ] `npm test` passes with zero failures (≥29 existing + all new stateSync tests)
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run build` clean

---

## COMPLETION CHECKLIST

- [ ] `src/types.ts` created and compiles
- [ ] `src/__fixtures__/mockBrowser.ts` created
- [ ] `src/content/stateSync.ts` created with all exported functions + `ThrottledStateWriter`
- [ ] `src/content/stateSync.test.ts` created covering all suites above
- [ ] `npm test` — all tests pass
- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npm run build` — clean output

---

## OPEN QUESTIONS / ASSUMPTIONS

**Assumed — throttle direction is leading-edge with trailing flush.**
The ticket says "save at most every 5 seconds." Interpreted as: write immediately on the first
call in a window; schedule the most recent pending value to write at the end of the window so no
state is silently dropped. If the intent was pure trailing-edge (always wait 5s before first
write), the `ThrottledStateWriter` can be adjusted — but leading-edge is safer for crash recovery.

**Assumed — storage errors during playback are fire-and-forget; surface on load/save.**
`savePlaybackState` called from `ThrottledStateWriter.writeNow` does not propagate errors to the
caller (audio pipeline). Errors from `flush()`, `loadStory`, `loadPlaybackState` DO propagate —
the orchestrator decides whether to surface them.

**Assumed — `stop` calls `clearPlaybackState`, not `flush`.**
TICKET-4 confirms "Hit stop → state is cleared." `ThrottledStateWriter.destroy()` is the right
call at stop (cancels without writing); `clearPlaybackState` erases the storage record.
`flush()` is for pause only.

**Assumed — URL comparison is exact string equality.**
No URL normalisation (no trailing-slash stripping, no lowercasing). Both the saved
`currentThreadmarkUrl` and the `currentUrl` argument come from `new URL(...).href` resolution in
the parser, which is already normalised.

**Assumed — `src/types.ts` is not a Vite entry point.**
It's a shared module imported by other entry points, not listed in `manifest.json`. Vite will
bundle it into whichever entry imports it. No change to `manifest.json` or `vite.config.ts` is
needed.

---

## NOTES

### Why `ThrottledStateWriter` is a class, not a closure

The class exposes `enqueue`, `flush`, and `destroy` as a clean interface the orchestrator can hold
onto via a single reference. A closure factory would work equally well, but the class makes
`intervalMs` injectable for testing without mocking `Date.now`.

### Throttle timing in tests

`vi.useFakeTimers()` controls `setTimeout` / `Date.now` together. Setting up fake timers before
each throttle test and restoring after is essential — if left enabled, async storage calls (which
use real Promises + microtasks) can behave unexpectedly because Vitest's fake timer implementation
does not advance microtasks automatically.

The safe pattern:
```ts
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
```

### Storage key design

Flat keys (`story:abc123`, `playback:abc123`) are simpler than namespaced objects
(`{ stories: { abc123: ... } }`) for `browser.storage.local`. Flat keys allow atomic get/set of
individual records without read-modify-write on the whole object, which matters once history is
added post-MVP.

### Why `browser.storage.sync` for preferences

Preferences (TTS speed, volume) are small and user-specific. `sync` makes them available across
devices automatically. The 100 KB limit is ample. `PlaybackState` is NOT synced — per-device
playback position is intentional (you might listen at different places on desktop vs. phone).

---

## AMENDMENTS

*(none yet)*
