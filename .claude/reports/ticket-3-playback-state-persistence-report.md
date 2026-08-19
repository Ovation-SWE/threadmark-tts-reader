# Implementation Report — TICKET-3: Playback State Persistence + Resume

**Plan**: `.claude/plans/ticket-3-playback-state-persistence.md`
**Branch**: `feature/ticket-3-playback-state-persistence`
**Status**: COMPLETE

## Summary

Implemented the storage layer (`stateSync.ts`) for the Threadmark TTS Reader extension. Defined four shared types (`Story`, `PlaybackState`, `UserPreferences`, `ResumeAction`) in `src/types.ts`, implemented all storage functions with correct key conventions (`story:{id}`, `playback:{storyId}`), a pure `resolveResume` function, the `ThrottledStateWriter` class with leading-edge + trailing-flush throttle, and `loadPreferences`/`savePreferences` via `browser.storage.sync`. Also created the shared `mockBrowser` fixture used by TICKET-2 and TICKET-4 tests.

## Tasks completed

- [Phase 1] `src/types.ts` → CREATE — `Story`, `PlaybackState`, `UserPreferences`, `ResumeAction`
- [Phase 2] `src/__fixtures__/mockBrowser.ts` → CREATE — in-memory `browser.storage` stub
- [Phase 3] `src/content/stateSync.ts` → CREATE — all storage functions + `ThrottledStateWriter` class
- [Phase 4] `src/content/stateSync.test.ts` → CREATE — full test suite (21 tests across 6 suites)

## Tests added

**File**: `src/content/stateSync.test.ts`

| Suite | Tests | Result |
|---|---|---|
| saveStory / loadStory round-trip | 2 | ✅ pass |
| savePlaybackState / loadPlaybackState round-trip | 2 | ✅ pass |
| clearPlaybackState | 2 | ✅ pass |
| resolveResume | 4 | ✅ pass |
| ThrottledStateWriter — throttle behaviour | 7 | ✅ pass |
| loadPreferences / savePreferences | 4 | ✅ pass |

**Total new tests**: 21 / 21 passing

## Validation results

- **`npx tsc --noEmit`**: ✅ zero errors
- **`npm test`**: 79 passed, 4 failed — all 21 new stateSync tests pass; 29 parser tests pass; 11 ttsEngine tests pass; 4 audioPlayer failures are pre-existing TICKET-2 work (untracked, not part of this ticket)
- **`npm run build`**: ✅ clean — `src/types.ts` bundled into consuming modules, not a standalone entry point

## Deviations from the plan

**`tsconfig.test.json` `exclude` override added**: The parent `tsconfig.json` excludes `src/**/*.test.ts` and `src/__fixtures__/**/*`. The child `tsconfig.test.json` listed those same patterns in its `include`, but TypeScript `exclude` takes precedence over `include` for files matching both — so the test tsconfig compiled nothing. Added `"exclude": ["node_modules", "dist"]` to `tsconfig.test.json` to override the inherited exclude and allow fixture/test files to be type-checked. This is a bug fix required to make the test infrastructure functional.

**Edge-case test added** — `resolveResume` with empty string URL: The plan's edge-case section mentioned "state whose URL is an empty string → treated as 'navigate'" but it wasn't in the explicit test suite list. Added it as a fourth `resolveResume` test to match the documented edge case.

## Issues encountered

Pre-existing TICKET-2 `audioPlayer.test.ts` failures (4 tests): The `audioPlayer.ts` and `audioPlayer.test.ts` files exist in the working tree as untracked TICKET-2 work. Their test failures are not caused by TICKET-3 changes and are out of scope.
