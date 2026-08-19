# PR #3 Review — TICKET-3: Playback State Persistence + Resume

**Branch**: `feature/ticket-3-playback-state-persistence` → `feature/ticket-2-tts-engine-audio-player`
**Reviewed by**: agentic code-reviewer (fresh context, no implementation knowledge)

---

## Validation

| Check | Result |
|---|---|
| `npm test` | ✅ 83/83 tests pass (4 test files) |
| `npx tsc --noEmit` | ✅ zero errors |
| `npm run build` | ✅ clean output |

---

## Findings

### Critical

None.

---

### High

**`mockBrowser.storage.local.get` only handles single-string keys — silent wrong-data risk for future callers** (`src/__fixtures__/mockBrowser.ts:8`)

The real `browser.storage.local.get` accepts `string | string[] | object | null`. The mock only handles `string`:

```ts
get: (key: string) => Promise.resolve({ [key]: local[key] }),
```

`stateSync.ts` only ever calls `.get()` with single strings, so there is **no current breakage**. However, the `browser` global is typed against `firefox-webext-browser` (the real webext types), not the mock. TypeScript compiles callers against the real API — which allows array keys — while the mock's runtime only handles strings. A future array-key call would silently return `{ "a,b": undefined }` instead of `{ a: ..., b: ... }`, passing tests while failing in production.

**Fix**: Either implement array-key support in the mock, or narrow the mock's TypeScript type to `string` so future callers get a type error before they reach tests:

```ts
// option A — handle array keys
get: (keys: string | string[]) => {
  const ks = Array.isArray(keys) ? keys : [keys];
  return Promise.resolve(Object.fromEntries(ks.map(k => [k, local[k]])));
},
// option B — explicitly narrow (and document)
get: (key: string) => ...  // with @param note: only single-key get supported
```

---

### Medium

**Missing test: second throttle window (enqueue after trailing-edge timer fires)** (`src/content/stateSync.test.ts` — gap)

After the trailing-edge timer fires and writes (updating `lastWriteAt`), a subsequent `enqueue` should trigger another immediate leading-edge write, not schedule a new timer. This "window reset" behavior is not tested. If a regression broke the `lastWriteAt` update inside the timer callback, all existing throttle tests would still pass.

**Fix**: Add a test that enqueues, advances timers past the interval so the trailing write fires, then enqueues again and verifies an immediate write (no second timer).

---

**`flush()` stamps `lastWriteAt` before `savePlaybackState` resolves — silent data loss on storage error** (`src/content/stateSync.ts:74-76`)

```ts
this.lastWriteAt = Date.now(); // stamped here
await savePlaybackState(state); // if this throws, lastWriteAt is already advanced
```

If `savePlaybackState` throws (e.g., storage quota exceeded, browser error), `lastWriteAt` has already advanced, the error propagates to the caller, and the state is lost with no retry path. `writeNow`'s fire-and-forget is explicitly documented as non-critical; `flush()` is not — it's called on pause where the user expects state to persist.

**Fix**: Either stamp `lastWriteAt` after the await (accepting that a rapid re-enqueue during the slow write could double-write), or wrap in try/catch and reset on failure:

```ts
try {
  await savePlaybackState(state);
  this.lastWriteAt = Date.now();
} catch (e) {
  // propagate to caller; lastWriteAt not advanced so retry can succeed
  throw e;
}
```

---

**`savePreferences` has a read-modify-write race** (`src/content/stateSync.ts:103-106`)

Two concurrent `savePreferences` calls both read the current snapshot, merge independently, then write — the later write silently overwrites the earlier one. Unlikely in a content script but the pattern is inherently racy.

**Fix**: Add a one-line comment acknowledging the race (`// single-caller assumption; not safe under concurrent calls`). Serialization is out of scope for MVP.

---

**`resolveResume` returns `{ type: "navigate", url: "" }` for a corrupted/empty `currentThreadmarkUrl`** (`src/content/stateSync.ts:39`)

Navigating to `""` would be a broken navigation. Callers cannot distinguish "navigate to a real URL" from "navigate to an empty string" without inspecting the `url` field. The behavior is tested correctly, but the edge case is undocumented in the type or function signature.

**Fix**: One-line JSDoc on `resolveResume` noting that callers should guard against `url === ""` on the `navigate` branch, OR add a guard in `resolveResume` returning `{ type: "none" }` for blank URLs.

---

### Low

**No JSDoc on `ThrottledStateWriter`** (`src/content/stateSync.ts:42`)
The leading-edge + trailing-flush + 5s throttle contract is non-obvious. A brief class-level comment would help TICKET-4's author (who wires this up) understand the invariants without reading all the tests.

**`mockBrowser` doesn't expose raw storage for assertion** (`src/__fixtures__/mockBrowser.ts`)
Tests can only verify via `load*` functions. Exporting `_local`/`_sync` would allow future tests to assert "key was NOT written" without going through the module under test.

**`destroy()` leaves `lastWriteAt` intact** (`src/content/stateSync.ts:80-86`)
Not a bug (the instance should not be reused after `destroy`), but a brief comment clarifying this is terminal would prevent misuse.

---

## What's done well

- Storage key helpers (`STORY_KEY`, `PLAYBACK_KEY`) are consistent between read and write paths — no key-name drift between `save*` and `load*` functions.
- `resolveResume` is correctly pure (no `browser` calls, no side effects) and all three `ResumeAction` branches are covered by tests.
- Throttle state isolation between test runs is clean: fresh `ThrottledStateWriter` instance per `it` block, fresh `makeMockBrowser()` per `describe` block via `beforeEach`/`afterEach`. No test-order dependencies.
- `loadPreferences` correctly merges saved partial data with `DEFAULT_PREFS` via spread — handles missing key (returns defaults) and partial saves (merges correctly). Both cases are tested.
- `tsconfig.test.json` fix is correctly applied and explained — the parent/child `exclude` conflict was a real infrastructure bug that would have silently broken fixture type-checking.

---

## Issue summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 4 |
| Low | 3 |

## Recommendation

**REQUEST CHANGES** — The High finding (mock API fidelity gap) and two of the Medium findings (`flush()` error handling; missing second-window throttle test) are worth fixing before merge. The fixes are small and contained to `mockBrowser.ts`, `stateSync.ts`, and `stateSync.test.ts`. No architectural changes needed.
