# Code Review — PR #1: feat: TICKET-1 — project scaffold + XenForo threadmark parser

**Reviewer**: agentic gate (fresh-eyes, independent context)
**Validation**: ✅ 29/29 tests · ✅ build clean · ✅ `tsc --noEmit` clean

---

## Critical issues

None.

---

## High issues

**`tsconfig.json:9` — `"node"` types leak into all extension source files**

`"types": ["firefox-webext-browser", "node"]` in the main `tsconfig.json` means `parser.ts`, `content/index.ts`, `background/index.ts`, and `popup/index.ts` all see Node.js globals (`Buffer`, `process`, `__dirname`, etc.) that do not exist at extension runtime. TypeScript will not catch accidental use of Node APIs in browser-context code.

`"node"` is already correctly listed in `tsconfig.test.json`. It should not be in `tsconfig.json`.

**Fix:** remove `"node"` from `tsconfig.json`'s `types` array.

```diff
- "types": ["firefox-webext-browser", "node"],
+ "types": ["firefox-webext-browser"],
```

---

## Medium issues

**`parser.ts:131` — `isThreadmarkPage` throws on an invalid URL instead of returning `false`**

`new URL(url).hostname` throws `TypeError` on a malformed URL string. A detection predicate called from a content script should be safe on arbitrary input.

```ts
export function isThreadmarkPage(doc: Document, url: string): boolean {
  let hostname: string;
  try { hostname = new URL(url).hostname; }
  catch { return false; }
  // …rest unchanged
}
```

---

**`parser.ts:73` — first capture group in `READER_URL_RE` is dead**

`/\/threads\/[^/]+\.(\d+)\/reader\/(\d+)\//` captures the thread numeric ID as group 1, but only group 2 (threadmark index) is consumed. The unused group is misleading. Use a non-capturing group:

```diff
- const READER_URL_RE = /\/threads\/[^/]+\.(\d+)\/reader\/(\d+)\//;
+ const READER_URL_RE = /\/threads\/[^/]+\.(?:\d+)\/reader\/(\d+)\//;
```

(`match[1]` then holds the index; `match[2]` usage becomes `match[1]` accordingly.)

---

**`parser.test.ts:58` — dead `result` variable**

`let result: ReturnType<typeof parseThreadmarkPage>` is assigned once in the "parses without throwing" case but never read — every subsequent test in the block calls `parseThreadmarkPage` independently. Dead code; remove the variable declaration.

---

**`tsconfig.test.json:6-7` — `module: "CommonJS"` conflicts with `import.meta.url`**

`tsconfig.test.json` overrides to `"module": "CommonJS"` / `"moduleResolution": "node"`, but `parser.test.ts` uses `import.meta.url` (ESM-only). Vitest's transform pipeline works around this at test runtime, but `tsc --project tsconfig.test.json` would flag `import.meta` as invalid. The override is unnecessary — remove it and let the base tsconfig + Vitest handle resolution.

```diff
  "compilerOptions": {
-   "types": ["node", "vitest/globals"],
-   "module": "CommonJS",
-   "moduleResolution": "node"
+   "types": ["node", "vitest/globals"]
  }
```

---

## Low issues

- **`parser.test.ts`** — `currentUrl` field is never asserted; small gap in interface coverage.
- **`parser.test.ts`** — the `replace(/\n{3,}/g, "\n\n")` whitespace-normalization branch in `extractBodyText` is exercised at runtime but has no dedicated test.
- **`manifest.json:33-36`** — `icons/icon-48.png` and `icons/icon-96.png` are referenced but the files don't exist. Firefox will log a warning when loading the extension. Not a blocker for development but worth fixing before any QA load.

---

## What's done well

- **Per-site `SiteSelectors` config map** is the right abstraction — divergences can be added without touching parse logic.
- **Loud failure on missing DOM elements** (throws with the failing selector) is exactly right for a parser driving an audio pipeline; silent nulls would cause mysterious playback failures downstream.
- **`resolveUrl` is defensively wrapped** in try/catch so malformed `href` values on nav links don't crash the parser.
- **`extractBodyText` clones before mutating** — no side effects on the live document, which matters once the content script is running alongside the page.
- **Test coverage is strong**: 29 tests span all three sites, the terminal-chapter null-`nextUrl` case, `storyId` stability across chapters and uniqueness across threads, and all four explicit-throw error paths.

---

## Validation

| Check | Result |
|---|---|
| `npm test` (Vitest 4.1.11, jsdom) | ✅ 29/29 passed |
| `npm run build` (Vite + vite-plugin-web-extension) | ✅ 3 entry points compiled cleanly |
| `npx tsc --noEmit` | ✅ no type errors |

---

## Recommendation

**REQUEST CHANGES** — one high issue (`tsconfig.json` leaks Node types into browser source) and three medium issues. All are one-to-five-line fixes. Implementation quality is solid and validation is fully clean. The PR should be approved immediately after the `tsconfig.json` `"node"` removal is confirmed.
