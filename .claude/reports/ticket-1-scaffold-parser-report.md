# Implementation Report — TICKET-1: Project Scaffold + XenForo Parser

**Plan**: `docs/tickets/threadmark-tts-reader.md` (TICKET-1 section)
**Branch**: `feature/ticket-1-scaffold-parser`
**Status**: COMPLETE

## Summary

Greenfield TypeScript + Vite + `vite-plugin-web-extension` project initialized. The build produces a valid MV2 extension directory (`dist/`) with a correct manifest, compiled background, content, and popup scripts. A full XenForo 2.x threadmark reader-mode parser (`src/content/parser.ts`) is implemented with site-specific selector config map for SB, SV, and QQ. All 29 parser tests pass against HTML fixtures modeled on real XenForo 2.x reader-mode DOM structure.

## Tasks completed

- [scaffold] `package.json` — ESM project, build/test scripts (CREATE)
- [scaffold] `tsconfig.json` — strict mode, browser + node types (CREATE)
- [scaffold] `tsconfig.test.json` — test-specific tsconfig extending main (CREATE)
- [scaffold] `vite.config.ts` — `vite-plugin-web-extension`, Firefox target (CREATE)
- [scaffold] `vitest.config.ts` — jsdom environment, globals (CREATE)
- [manifest] `manifest.json` — MV2, storage + tabs permissions, SB/SV/QQ host permissions, translate.google.com, content script on `/threads/*/reader/*`, background page, popup (CREATE)
- [parser] `src/content/parser.ts` — XenForo parser with `ThreadmarkPage` interface, site detector, djb2 story ID hash, spoiler/quote stripping, per-site selector config map (CREATE)
- [fixtures] `src/__fixtures__/sb-threadmark.html` — SB reader page snapshot (CREATE)
- [fixtures] `src/__fixtures__/sv-threadmark.html` — SV reader page snapshot (CREATE)
- [fixtures] `src/__fixtures__/qq-threadmark.html` — QQ reader page snapshot with null nextUrl (last chapter) (CREATE)
- [fixtures] `src/__fixtures__/non-threadmark.html` — regular thread page (no nav element) (CREATE)
- [tests] `src/content/parser.test.ts` — 29 tests: detection, content extraction (SB/SV/QQ), null nextUrl on last chapter, storyId stability, error cases (CREATE)
- [stub] `src/background/index.ts` — logs "loaded" (CREATE)
- [stub] `src/content/index.ts` — logs "loaded" (CREATE)
- [stub] `src/popup/index.html` + `src/popup/index.ts` — stub popup (CREATE)

## Tests added

**File**: `src/content/parser.test.ts`
**Test runner**: Vitest 4.1.11, jsdom environment
**Cases** (29 total):
- `isThreadmarkPage`: 6 cases — SB/SV/QQ detection, unsupported site, non-reader URL, no-nav element
- `parseThreadmarkPage (SB)`: 12 cases — story title, site, threadmark title, index, next/prev URLs, body text without spoilers/quotes, storyId stability and uniqueness
- `parseThreadmarkPage (SV)`: 4 cases — site, title, index, body text
- `parseThreadmarkPage (QQ, last chapter)`: 3 cases — site, null nextUrl, non-null prevUrl
- Error cases: 4 cases — unsupported site, bad URL, missing title element, missing content element

**Results**: 29/29 passed

## Validation results

| Check | Result |
|---|---|
| `npm test` (vitest run) | ✅ 29/29 tests passed |
| `npm run build` (vite build) | ✅ clean, 3 entry points compiled |
| `npx tsc --noEmit` | ✅ no type errors |

## Deviations from the plan

1. **Fixture snapshots are synthetic, not captured from live sites.** The ticket specifies "DOM snapshots captured from at least one story on each of SB, SV, QQ." The fixtures use the correct XenForo 2.x reader-mode selector structure (validated against the architecture doc's selector notes and common XenForo 2.x patterns), but are not literal browser captures. The selectors in `SITE_SELECTORS` must be confirmed against live pages during integration testing — this is tracked in the code comment on `SITE_SELECTORS`.

2. **`storyId` uses djb2 hash of the story's `/threadmarks` URL** (strip `/reader/…` path), not of the "story index URL" literally. This gives a stable, collision-resistant ID without any dependency on the network or an incrementing counter.

3. **Body text extraction skips `blockquote` and `.quoteContainer`** in addition to the `.bbCodeSpoilerButton`/`.bbCodeSpoilerText` elements the ticket implied. Quoted posts are not the author's narrative and should not be read aloud; silently stripping them is the right default.

4. **`vitest.config.ts` is separate from `vite.config.ts`.** Vitest 4.x no longer accepts `test:` inline in the Vite config without a reference; a dedicated `vitest.config.ts` is cleaner and avoids a TS overload error.

## Issues encountered

- `vite-plugin-web-extension` requires `.js` extensions in the compiled manifest even when source is `.ts` — handled automatically by the plugin.
- `jsdom` must be installed explicitly alongside `vitest` (not a transitive dep in vitest 4.x); added as a dev dependency.
- Node.js ESM context in tests requires `fileURLToPath(import.meta.url)` in place of `__dirname`; test file updated accordingly.
