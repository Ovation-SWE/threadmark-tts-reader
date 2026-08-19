# Feature: TICKET-2 — TTS Engine + Audio Player

The following plan should be complete, but validate documentation and codebase patterns before implementing.
Pay special attention to naming of existing types, imports, and jsdom mock patterns already used in parser.test.ts.

## Feature Description

Implement the two core audio modules for the Threadmark TTS Reader:

1. **`ttsEngine.ts`** — splits arbitrary text into ≤190-character chunks at word boundaries, fetches each chunk as an MP3 blob from the Google Translate TTS endpoint (with retry/backoff), and yields `{ blobUrl, charOffset }` objects via an async generator. Revokes the previous blob URL before yielding the next to prevent memory leaks.

2. **`audioPlayer.ts`** — owns a single `<audio>` element injected into the page, registers with the OS Media Session API (so the OS treats the extension like a media player), plays TTS chunks sequentially, and fires callbacks on chapter exhaustion and errors. Exposes `play(chunks)`, `pause()`, `resume()`, `stop()`, and `currentCharOffset()`.

## User Story

As a reader of serialized web fiction on SB/SV/QQ,
I want the extension to fetch and play TTS audio for a chapter's text automatically,
So that I can listen to a full chapter without manual interaction.

## Problem Statement

TICKET-1 established the parser that extracts clean `bodyText` from a threadmark page. This ticket builds the two modules that turn that text into audio and play it through the browser's audio pipeline, registered with the OS media controls.

## Solution Statement

Split `bodyText` into ≤190-char chunks (Google Translate TTS character limit), fetch each chunk as a blob from the unofficial Google Translate TTS endpoint, convert to a blob URL, and stream through an `<audio>` element with Media Session API registration. Revoke blob URLs after use. Retry failed fetches with exponential backoff. Signal errors via callback rather than silently stopping.

## Out of Scope / Non-Goals

- Web Speech API / offline TTS fallback — post-MVP
- ArrayBuffer + Web Audio API fallback for CSP-blocked blob URLs — documented open risk, not TICKET-2
- Cross-chapter auto-advance (navigating to `nextUrl` when a chapter ends) — TICKET-4
- State persistence (`stateSync.ts`) — TICKET-3
- Popup UI — TICKET-4
- Pre-fetching the _next threadmark's_ audio while current plays — post-MVP (within-chapter sequential playback is the goal here)
- Rate-limit handling (429 responses) — monitor during TICKET-4 E2E; not blocking now

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium
**Primary Systems Affected**: `src/content/ttsEngine.ts`, `src/content/audioPlayer.ts`
**Dependencies**: TICKET-1 (TypeScript scaffold, build pipeline, types)

## Related Work

**Implements**: TICKET-2 from `docs/tickets/threadmark-tts-reader.md`
**Epic architecture**: `threadmark-tts-reader.arch.md` — TTS Engine, Data Model, Boundaries & Contracts sections

**Back-references**:
- `.claude/plans/` (no prior plans — TICKET-1 had no plan file)

**Forward-references**:
- (TICKET-3 plan — will consume `TtsChunk.charOffset` for state persistence)
- (TICKET-4 plan — will import and wire `AudioPlayer` + `ttsChunks`)

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ BEFORE IMPLEMENTING

- `src/content/parser.ts` (lines 1-23) — `ThreadmarkPage.bodyText` is the input to `ttsChunks`. `Site` type is already defined here; do not redefine it.
- `src/content/parser.test.ts` (lines 1-12) — Vitest + jsdom test setup pattern: `import { describe, it, expect } from "vitest"`, no `vi` import in scope unless you add it. See how fixtures are loaded. **Mirror this import pattern.**
- `vitest.config.ts` — `environment: "jsdom"`, `globals: true` (so `describe`/`it`/`expect` are global, but `vi` must be explicitly imported from `"vitest"`)
- `tsconfig.json` (lines 7-10) — `"lib": ["ES2020", "DOM"]`, `"types": ["firefox-webext-browser"]`. `MediaMetadata` and `navigator.mediaSession` are DOM types — they _are_ in scope. If TypeScript can't resolve them, add `"lib": ["ES2020", "DOM", "DOM.Iterable"]` to tsconfig.
- `package.json` — no runtime dependencies; all browser APIs (`fetch`, `URL`, `HTMLAudioElement`, `navigator.mediaSession`) are native.

### New Files to Create

- `src/content/ttsEngine.ts` — text chunking + TTS fetch → `AsyncGenerator<TtsChunk>`
- `src/content/ttsEngine.test.ts` — unit tests for chunking, fetch lifecycle, retry
- `src/content/audioPlayer.ts` — `<audio>` element owner + Media Session integration
- `src/content/audioPlayer.test.ts` — unit tests for playback state machine, callbacks

### Relevant Documentation — CONSULT BEFORE IMPLEMENTING

- Architecture doc `threadmark-tts-reader.arch.md`, section "TTS Engine" — endpoint URL, chunk size, Referer header, why not Web Speech API
- Architecture doc, section "Boundaries & Contracts" — CSP footnote (blob URLs may be blocked; we implement the primary path only; note the risk for TICKET-4)
- Architecture doc, section "Key Decisions → Stack" — no external npm runtime deps; keep the extension small
- TICKET-2 spec in `docs/tickets/threadmark-tts-reader.md` (lines 63–98) — acceptance criteria, exact function signatures, error event wording

### Patterns to Follow

**Module structure:** Each file is a plain ES module with named exports. No default exports (mirrors `parser.ts`).

**TypeScript strictness:** `strict: true`, `noUncheckedIndexedAccess: true`. Every array index access must be guarded or typed non-optionally. Example from parser.ts:
```typescript
const match = READER_URL_RE.exec(url);
if (!match) throw new Error(`...`);
const threadmarkIndex = parseInt(match[1] ?? "0", 10);
// match[1] is string | undefined under noUncheckedIndexedAccess
```

**Error surfacing:** Parser throws descriptive errors rather than returning null (from `parseThreadmarkPage`). AudioPlayer follows the same principle: errors are surfaced via callback, not swallowed.

**No external runtime deps:** Fetch, URL, HTMLAudioElement, and navigator.mediaSession are all native browser APIs. Do not add npm packages.

**Test pattern — pure logic:** `chunkText` is a pure function; test it directly with no mocks. Mirror the `describe`/`it`/`expect` style in `parser.test.ts`.

**Test pattern — mocking fetch:** Use `vi.stubGlobal('fetch', vi.fn(...))` from Vitest. Remember to restore with `vi.unstubAllGlobals()` in `afterEach` or use `vi.restoreAllMocks()`.

**Test pattern — mocking HTMLAudioElement:** jsdom includes a stub `HTMLAudioElement` but `.play()` returns a rejected promise by default. Stub `HTMLAudioElement.prototype.play` with `vi.fn().mockResolvedValue(undefined)` before tests, restore after. Simulate `ended` by manually dispatching `new Event('ended')` on the element.

**Naming conventions:** camelCase functions/variables, PascalCase interfaces/classes, SCREAMING_SNAKE for module-level constants. (From parser.ts: `SITE_SELECTORS`, `READER_URL_RE`, `detectSite`, `hashString`.)

---

## DESIGN DECISIONS

### `TtsChunk` interface (deviation from raw spec)

The ticket spec gives `async function* ttsChunks(text: string): AsyncGenerator<string>` (blob URLs only).
However, `AudioPlayer.currentCharOffset()` needs to know the character position of each chunk's start within the full text. Rather than having the caller independently re-chunk and cross-reference, `ttsChunks` yields:

```typescript
export interface TtsChunk {
  blobUrl: string;
  charOffset: number;  // start index in the original text string
}
```

`chunkText()` is exported so TICKET-3/4 can call it independently if needed, and so it can be unit-tested in isolation.

### AudioPlayer method signature

The ticket lists `play()`, `pause()`, `stop()`, `currentCharOffset()`. `play()` with no args is ambiguous (start or resume?). The plan uses:

- `play(chunks: AsyncGenerator<TtsChunk>)` — begins a new playback session; stops any current session first
- `pause()` — suspends the `<audio>` element; generator stays live
- `resume()` — calls `audio.play()` to continue from where paused; Media Session `play` handler uses this
- `stop()` — aborts the generator loop, clears state, resets `charOffset` to 0
- `currentCharOffset(): number` — returns the `charOffset` of the chunk currently (or last) playing

The Media Session API `play` action handler wires to `resume()`, not `play()`, because the OS play button means "resume", not "start with new content."

### Blob URL revocation timing

The previous blob URL is revoked at the start of the _next_ iteration — i.e., when the consumer (AudioPlayer) calls `generator.next()` again, meaning it has finished playing the previous chunk. This ensures the URL is still valid while the audio element is using it.

### Retry/backoff

3 retries, exponential backoff: 500 ms, 1000 ms, 2000 ms (base 500 ms, `2^attempt * 500`). After 3 failures, `ttsChunks` throws; AudioPlayer catches and calls `onError`.

### Stop with AbortController

`AudioPlayer` creates an `AbortController` when `play()` starts. `stop()` calls `abort()`. The internal async loop checks `signal.aborted` before advancing to each new chunk, and listens for `abort` to break out of the `audio.ended` wait.

### `currentCharOffset()` resolution

Returns the `charOffset` of the chunk that _started_ playing most recently. Mid-chunk audio position is not tracked (no way to map audio time → text position). Callers (TICKET-3) should treat this as the nearest chunk-boundary offset — acceptable for MVP per architecture doc open question on resume fidelity.

---

## IMPLEMENTATION PLAN

### Phase 1: TTS Engine (`ttsEngine.ts` + tests)

**Tasks:**
- Implement `chunkText(text: string): string[]` (pure, exported)
- Implement `ttsChunks(text: string): AsyncGenerator<TtsChunk>`
- Write `ttsEngine.test.ts`

### Phase 2: Audio Player (`audioPlayer.ts` + tests)

**Depends on:** Phase 1 (imports `TtsChunk` type)
**Independent of:** anything in Phase 1 tests

**Tasks:**
- Implement `AudioPlayer` class
- Write `audioPlayer.test.ts`

### Phase 3: Validation

**Depends on:** Phase 1 and Phase 2 complete

**Tasks:**
- `npm test` — all tests pass (29 existing + new)
- `npx tsc --noEmit` — zero type errors
- `npm run build` — extension compiles clean

---

## STEP-BY-STEP TASKS

### CREATE `src/content/ttsEngine.ts`

- **IMPLEMENT**: Module-level constants:
  ```typescript
  const MAX_CHUNK_CHARS = 190;
  const MAX_RETRIES = 3;
  const TTS_BASE_URL = "https://translate.google.com/translate_tts";
  ```
- **IMPLEMENT**: `export interface TtsChunk { blobUrl: string; charOffset: number; }`
- **IMPLEMENT**: `export function chunkText(text: string): string[]`
  - Trim the input. Return `[]` for empty string.
  - Loop: if remaining text fits in `MAX_CHUNK_CHARS`, push and break.
  - Otherwise find `lastIndexOf(' ', MAX_CHUNK_CHARS)` in the slice; if `-1` (no space), hard-split at `MAX_CHUNK_CHARS`.
  - Trim each chunk. Advance `remaining` by the split point.
  - **GOTCHA**: `noUncheckedIndexedAccess` — `str.lastIndexOf` returns `number`, not `number | undefined`, so no guard needed there. But when slicing/splitting, be explicit.
- **IMPLEMENT**: Internal `ttsUrl(chunk: string): string` — returns the Google Translate URL with `encodeURIComponent(chunk)`.
- **IMPLEMENT**: Internal `async function fetchBlobWithRetry(url: string): Promise<Blob>` — up to `MAX_RETRIES` attempts; exponential backoff `2 ** attempt * 500` ms between attempts; throws on final failure. Fetch with `{ headers: { Referer: "https://translate.google.com/" } }`. Throw on non-`resp.ok`.
- **IMPLEMENT**: `export async function* ttsChunks(text: string): AsyncGenerator<TtsChunk>` —
  1. Call `chunkText(text)` to get chunks array.
  2. Track `charOffset = 0` (cumulative start position of each chunk in the original text).
  3. Track `prevBlobUrl: string | null = null`.
  4. For each chunk: revoke `prevBlobUrl` if set, fetch blob, create URL, yield `{ blobUrl, charOffset }`, advance `charOffset` by chunk length + 1 (for the space that was the split point — approximate; exact tracking is not required).
  5. After the loop: revoke `prevBlobUrl` (the last one).
  - **GOTCHA**: `charOffset` advances by the chunk's length in the original text, not the trimmed chunk. Since chunks are trimmed and split at spaces, accumulate `splitAt` values rather than `chunk.length` for precise tracking. For MVP, approximating with `chunk.length + 1` is acceptable — document it.
  - **GOTCHA**: `URL.createObjectURL` and `URL.revokeObjectURL` are available in content script context (browser page origin). No import needed.
- **VALIDATE**: `npx tsc --noEmit`

### CREATE `src/content/ttsEngine.test.ts`

- **IMPLEMENT**: `import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";`
- **IMPLEMENT**: `import { chunkText, ttsChunks } from "./ttsEngine";`
- **IMPLEMENT**: `describe("chunkText")` — test cases:
  - `chunkText("")` → `[]`
  - `chunkText("hello world")` → `["hello world"]`
  - text of exactly 190 chars → single chunk
  - text of 191 chars with a space at position 180 → two chunks, split at space
  - text of 200 chars with no spaces → hard-split: `[text.slice(0,190), text.slice(190)]`
  - all chunks in result have `length <= 190`
- **IMPLEMENT**: `describe("ttsChunks")` — mock `fetch` and `URL`:
  ```typescript
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(["mp3data"], { type: "audio/mpeg" })),
    }));
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn((blob) => `blob:mock-${Math.random()}`),
      revokeObjectURL: vi.fn(),
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  ```
  - Single-chunk text yields one `TtsChunk` with `charOffset: 0`
  - Two-chunk text yields two items; second has `charOffset > 0`
  - `URL.revokeObjectURL` called once after consuming both chunks (last blob revoked after loop)
  - `URL.revokeObjectURL` called before yielding second chunk (previous blob revoked at start of next iteration)
  - On fetch failure (mock returns `ok: false`), retries `MAX_RETRIES` times then throws
  - Fetch request includes `Referer: "https://translate.google.com/"` header
  - URL contains `encodeURIComponent` of the chunk text
- **GOTCHA**: `vi` must be explicitly imported in Vitest when `globals: true` — `vi` is NOT auto-injected globally like `describe`/`it`. Always import it.
- **VALIDATE**: `npm test -- ttsEngine`

### CREATE `src/content/audioPlayer.ts`

- **IMPLEMENT**: `import type { TtsChunk } from "./ttsEngine";`
- **IMPLEMENT**: Interface:
  ```typescript
  export interface AudioPlayerOptions {
    onExhausted: () => void;
    onError: (err: Error) => void;
  }
  ```
- **IMPLEMENT**: `export class AudioPlayer` — constructor accepts `(doc: Document, options: AudioPlayerOptions)`:
  - Creates `<audio>` element: `doc.createElement("audio")`, sets `audio.preload = "auto"`, appends to `doc.body`.
  - Stores `_audio`, `_options`, `_charOffset = 0`, `_stopController: AbortController | null = null`.
  - Registers Media Session handlers in constructor (empty initially — they delegate to `this._audio.play()` / `pause()`):
    ```typescript
    if ("mediaSession" in navigator) {
      navigator.mediaSession.setActionHandler("play", () => this._audio.play());
      navigator.mediaSession.setActionHandler("pause", () => this.pause());
      navigator.mediaSession.setActionHandler("stop", () => this.stop());
    }
    ```
  - **GOTCHA**: `navigator.mediaSession` may not exist in jsdom test environment. Always guard with `"mediaSession" in navigator`.
- **IMPLEMENT**: `play(chunks: AsyncGenerator<TtsChunk>, metadata?: { title: string; artist: string }): void`
  - Calls `this.stop()` first to clean up any running session.
  - If `metadata` is provided and `"mediaSession" in navigator`, sets `navigator.mediaSession.metadata = new MediaMetadata(metadata)`.
  - Creates a new `AbortController`, stores as `this._stopController`.
  - Starts `this._runLoop(chunks, ac.signal)` as a floating promise (call `.catch(err => this._options.onError(err))`).
- **IMPLEMENT**: `pause(): void` — calls `this._audio.pause()`.
- **IMPLEMENT**: `resume(): void` — calls `this._audio.play()`. No-op if not paused (browser handles this gracefully).
- **IMPLEMENT**: `stop(): void`:
  - `this._stopController?.abort(); this._stopController = null;`
  - `this._audio.pause(); this._audio.src = "";`
  - `this._charOffset = 0;`
- **IMPLEMENT**: `currentCharOffset(): number` — returns `this._charOffset`.
- **IMPLEMENT**: Private `async _runLoop(chunks: AsyncGenerator<TtsChunk>, signal: AbortSignal): Promise<void>`:
  ```typescript
  try {
    for await (const chunk of chunks) {
      if (signal.aborted) return;
      this._charOffset = chunk.charOffset;
      this._audio.src = chunk.blobUrl;
      await new Promise<void>((resolve, reject) => {
        const onEnded = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); reject(new Error("Audio playback error")); };
        const onAbort = () => { cleanup(); resolve(); };
        const cleanup = () => {
          this._audio.removeEventListener("ended", onEnded);
          this._audio.removeEventListener("error", onError);
          signal.removeEventListener("abort", onAbort);
        };
        this._audio.addEventListener("ended", onEnded, { once: true });
        this._audio.addEventListener("error", onError, { once: true });
        signal.addEventListener("abort", onAbort, { once: true });
        this._audio.play().catch(reject);
      });
      if (signal.aborted) return;
    }
    if (!signal.aborted) this._options.onExhausted();
  } catch (err) {
    if (!signal.aborted) {
      this._options.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }
  ```
- **GOTCHA**: `for await` on an async generator that itself throws will surface the error in the `catch` block. The `onError` callback in the generator (ttsEngine retry exhaustion) is the correct path to `onError`.
- **GOTCHA**: TypeScript may complain about `signal.addEventListener` if `AbortSignal` type doesn't include `EventTarget` methods in `ES2020`. If so, cast: `(signal as EventTarget).addEventListener(...)`. Alternatively use `signal.onabort = ...` (but that overwrites a single handler). Prefer keeping the full `EventTarget` approach and checking types.
- **VALIDATE**: `npx tsc --noEmit`

### CREATE `src/content/audioPlayer.test.ts`

- **IMPLEMENT**: Imports:
  ```typescript
  import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
  import { AudioPlayer } from "./audioPlayer";
  import type { TtsChunk } from "./ttsEngine";
  ```
- **IMPLEMENT**: Helpers:
  ```typescript
  function makeChunks(offsets: number[]): AsyncGenerator<TtsChunk> {
    async function* gen() {
      for (const offset of offsets) {
        yield { blobUrl: `blob:mock-${offset}`, charOffset: offset };
      }
    }
    return gen();
  }
  ```
- **IMPLEMENT**: `beforeEach` — stub `HTMLAudioElement.prototype.play`:
  ```typescript
  vi.spyOn(HTMLAudioElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLAudioElement.prototype, "pause").mockImplementation(() => {});
  ```
- **IMPLEMENT**: `afterEach` — `vi.restoreAllMocks()`
- **IMPLEMENT**: `describe("construction")`:
  - Constructor injects an `<audio>` element into `document.body`
  - `currentCharOffset()` returns `0` initially
- **IMPLEMENT**: `describe("play() and auto-advance")`:
  - After `play(makeChunks([0, 100]))`, first chunk's `charOffset` is set; simulate `ended` event on audio element → second chunk plays
  - `currentCharOffset()` updates to `100` after second chunk starts
  - After all chunks end, `onExhausted` is called
  - Helper to simulate chunk completion:
    ```typescript
    function fireEnded(el: HTMLAudioElement) {
      el.dispatchEvent(new Event("ended"));
    }
    ```
- **IMPLEMENT**: `describe("pause/resume")`:
  - `pause()` calls `audio.pause()`
  - `resume()` calls `audio.play()`
  - `currentCharOffset()` unchanged after pause
- **IMPLEMENT**: `describe("stop()")`:
  - `stop()` resets `currentCharOffset()` to 0
  - `onExhausted` is NOT called after `stop()`
  - Calling `stop()` mid-playback and then playing new chunks works (state is clean)
- **IMPLEMENT**: `describe("onError")`:
  - If `play()` rejects (mock `audio.play` to reject), `onError` is called with an `Error`
  - `onExhausted` is NOT called when error occurs
- **GOTCHA**: jsdom's `HTMLAudioElement` is a stub; it won't fire `ended` automatically. Always manually dispatch `new Event("ended")` in tests that need to advance chunks.
- **GOTCHA**: The `play()` mock must be set up _before_ `new AudioPlayer(...)` if the constructor calls play, but our constructor does not autoplay — setup in `beforeEach` is fine.
- **VALIDATE**: `npm test -- audioPlayer`

### VALIDATE full suite + build

- **VALIDATE**: `npm test` — all tests pass (29 existing parser tests + new ttsEngine + audioPlayer tests)
- **VALIDATE**: `npx tsc --noEmit` — zero type errors
- **VALIDATE**: `npm run build` — dist/ builds cleanly with all three entry points

---

## TESTING STRATEGY

### Unit Tests

All tests use Vitest 4 + jsdom (configured globally in `vitest.config.ts`). No additional test runner setup needed.

**`ttsEngine.test.ts`** — pure logic (chunking) tested with no mocks; fetch-dependent logic tested with `vi.stubGlobal`. Focus on boundary conditions and blob URL lifecycle.

**`audioPlayer.test.ts`** — `HTMLAudioElement.prototype.play/pause` stubbed via `vi.spyOn`. `ended` events fired manually to drive the async loop forward. Callbacks (`onExhausted`, `onError`) asserted via `vi.fn()`.

### Edge Cases

**ttsEngine:**
- Empty string → zero iterations, no fetch, no crash
- Text of exactly 190 chars → single chunk, no split
- Word longer than 190 chars → hard-split, no crash
- Fetch fails on all 3 retries → generator throws, caller gets Error
- Fetch returns `ok: false` (e.g. 429) → treated as failure, retried

**audioPlayer:**
- `stop()` called before any chunks play → no-op, no crash
- `stop()` called mid-playback → onExhausted NOT called
- `play()` called while already playing → stops previous session cleanly
- Error from `audio.play()` rejection → `onError` called, no hang
- Single-chunk text → `onExhausted` fires after the one chunk ends

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

### Level 3: Unit tests (targeted)
```bash
npm test -- ttsEngine
npm test -- audioPlayer
```

### Level 4: Build
```bash
npm run build
```

### Level 5: Manual smoke (optional, after TICKET-4)
Load extension in Firefox, open an SB threadmark page, call `ttsChunks(bodyText)` from devtools console, verify audio plays.

---

## ACCEPTANCE CRITERIA

- [ ] `chunkText` splits text at word boundaries, never exceeds 190 chars per chunk, handles empty string and very long words
- [ ] `ttsChunks` yields `TtsChunk { blobUrl, charOffset }` for each chunk; `blobUrl` is a valid `blob:` URL
- [ ] `URL.revokeObjectURL` is called for each blob URL (no leak); timing: previous revoked at start of next iteration
- [ ] Failed fetch retries up to 3 times with exponential backoff; throws after all retries fail
- [ ] Fetch request includes `Referer: https://translate.google.com/` header
- [ ] Google Translate URL is correctly formed with `encodeURIComponent(chunk)`
- [ ] `AudioPlayer` injects one `<audio>` element into the document on construction
- [ ] `play(chunks)` plays chunks sequentially; `onExhausted` fires after the last chunk's `ended` event
- [ ] `pause()` and `resume()` suspend and continue playback without losing position
- [ ] `stop()` aborts the loop; `onExhausted` is NOT called; `currentCharOffset()` resets to 0
- [ ] `currentCharOffset()` returns the `charOffset` of the currently/last playing chunk
- [ ] Media Session API handlers (`play`/`pause`/`stop`) are registered; guarded for environments without `navigator.mediaSession`
- [ ] `onError` callback fires (not a silent stop) when `audio.play()` rejects or ttsEngine throws after retries
- [ ] All existing 29 parser tests still pass
- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] `npm run build` produces a valid extension in `dist/`

---

## COMPLETION CHECKLIST

- [ ] `src/content/ttsEngine.ts` created
- [ ] `src/content/ttsEngine.test.ts` created, all tests pass
- [ ] `src/content/audioPlayer.ts` created
- [ ] `src/content/audioPlayer.test.ts` created, all tests pass
- [ ] `npm test` — all tests pass (no regressions)
- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npm run build` — clean build
- [ ] Acceptance criteria above all met

---

## OPEN QUESTIONS / ASSUMPTIONS

**Assumed — charOffset accumulation is approximate:** `charOffset` in `TtsChunk` advances by `chunk.length + 1` (chunk text length plus the space that was the split boundary). The exact number of whitespace chars consumed varies. For MVP resume granularity (nearest chunk boundary), this is acceptable per architecture doc open question.

**Assumed — `currentCharOffset()` returns chunk-start offset only:** Mid-chunk audio time is not mapped back to text position. TICKET-3 will save this offset to storage; on resume, playback will restart from the nearest chunk boundary, not the exact sentence.

**Assumed — `MediaMetadata` constructor is available:** DOM lib in `tsconfig.json` (`"lib": ["ES2020", "DOM"]`) should include `MediaMetadata`. If `tsc` errors on `new MediaMetadata(...)`, the fix is to add `"DOM.Iterable"` to `lib` or add a type declaration. This is a TS config tweak, not a design change.

**Assumed — Content script fetch includes browser User-Agent automatically:** Per architecture doc, the browser sends its real UA header on content script fetches without any spoofing. The only extra header needed is `Referer`.

**Open — CSP + blob URLs on SB/SV/QQ:** If the sites block `blob:` URLs in content script `<audio>` elements, the fallback is `ArrayBuffer` + Web Audio API. This is explicitly out of scope for TICKET-2. TICKET-4's integration test will surface this issue if it exists.

---

## NOTES

### Why `TtsChunk` instead of `string`

The raw spec says `AsyncGenerator<string>`, but `AudioPlayer.currentCharOffset()` needs chunk boundaries from the source text. Adding `charOffset` to the yielded object is the minimal change that avoids the caller needing to independently re-chunk just to track position.

### Retry timing

500ms / 1000ms / 2000ms is conservative for a TTS service with no rate-limit headers. If 429s appear during TICKET-4 E2E testing, the backoff base can be increased. For TICKET-2, the unit tests mock `fetch`, so no real requests are made.

### AbortController for stop()

The alternative is a `_stopped` flag checked at loop boundaries. `AbortController` is cleaner because it also cancels the in-flight `audio.ended` wait (via the `abort` event listener), avoiding a case where `stop()` is called mid-chunk and the loop hangs until that chunk finishes.

### Media Session API on GeckoView

The architecture doc flags this as an unvalidated assumption (Spike 1 was done on desktop). The TICKET-2 code is correct per the Media Session spec; whether it survives backgrounding on Firefox for Android is validated manually after TICKET-4. No code change needed here regardless of outcome (the fallback is different TTS approach, not different Media Session usage).

---

## AMENDMENTS

(none yet)
