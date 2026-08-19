# PR #2 Review (Round 2) — TTS Engine, Audio Player, and Playback State Persistence

**PR**: feat: TTS engine, audio player, and playback state persistence (TICKET-2 + TICKET-3)
**Reviewer**: code-reviewer agent (fresh-eyes pass, round 2 after fix)
**Recommendation**: ✅ Approve

## Validation

| Check | Result |
|-------|--------|
| `npm test` | ✅ 84/84 pass |
| `npx tsc --noEmit` | ✅ zero errors |
| `npm run build` | ✅ clean, all 3 entry points |

## Fix Verification — `try/finally` in `ttsChunks`

The fix from round 1 is correct across all paths:

**Normal completion:** Last chunk URL sits in `prevBlobUrl` when the loop exits. `finally` revokes it — same behavior as the original explicit post-loop revocation, no double-revocation.

**Early exit via `stop()`:** `stop()` calls `abort()` synchronously → `onAbort` → `resolve()` (queued as microtask) → `stop()` continues synchronously to `audio.src = ""` → *then* the microtask resumes `_runLoop`, exits `for await`, calls `generator.return()`, triggering `finally`. By the time `finally` runs, `audio.src` is already `""` and the audio element holds no reference. Safe.

**Fetch failure mid-stream:** If `fetchBlobWithRetry` throws, `finally` runs with `prevBlobUrl` holding the last successfully created URL (or `null` on first chunk). Revoked correctly — no leak.

**No double-revocation:** Per-iteration revocation at the loop top is unchanged. `finally` only handles the last URL. No URL is revoked twice.

## New Issues

None. The fix is purely additive and introduces no new behavior on the happy path.

## Summary

Round 1's medium finding (blob URL leak on generator abandonment) is correctly resolved. No new issues introduced. All three low-severity findings from round 1 remain appropriately deferred. The PR is ready to merge.

---

*Posted on the PR. A human now reviews the code + this review and merges.*
